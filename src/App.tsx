import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  collection, 
  onSnapshot, 
  addDoc, 
  updateDoc, 
  doc, 
  serverTimestamp, 
  query, 
  where, 
  orderBy,
  Timestamp,
  setDoc,
  getDoc,
  deleteDoc
} from 'firebase/firestore';
import { onAuthStateChanged, User } from 'firebase/auth';
import { auth, db, signInWithGoogle, logout, getToken, onMessage, messaging } from './lib/firebase';
import { handleFirestoreError } from './lib/error-handler';
import { UserProfile, Premise, AttendanceLog, OperationType, Location } from './types';
import { calculateDistance } from './lib/geo-utils';
import { MapContainer, TileLayer, Circle, Marker, Popup, useMapEvents, useMap } from 'react-leaflet';
import L from 'leaflet';
import { 
  MapPin, 
  LogOut, 
  LogIn as LoginIcon, 
  ShieldAlert, 
  Plus, 
  History, 
  Download, 
  LayoutDashboard,
  Settings,
  User as UserIcon,
  Navigation,
  CheckCircle2,
  XCircle,
  Bell,
  BellOff
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { format } from 'date-fns';

// Fix Leaflet marker icon issue
// @ts-ignore
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
// @ts-ignore
import markerIcon from 'leaflet/dist/images/marker-icon.png';
// @ts-ignore
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

// @ts-ignore
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

// --- Components ---

function Button({ children, onClick, variant = 'primary', className = '', disabled = false, icon: Icon }: any) {
  const base = "flex items-center justify-center gap-2 px-4 py-2 rounded-lg font-medium transition-all active:scale-95 disabled:opacity-50 disabled:active:scale-100 cursor-pointer";
  const variants: any = {
    primary: "bg-neutral-900 text-white hover:bg-neutral-800",
    secondary: "bg-white text-neutral-900 border border-neutral-200 hover:bg-neutral-50",
    danger: "bg-red-600 text-white hover:bg-red-700",
    ghost: "text-neutral-600 hover:bg-neutral-100"
  };
  return (
    <button id={`btn-${children?.toString()?.toLowerCase()?.replace(/\s+/g, '-')}`} disabled={disabled} onClick={onClick} className={`${base} ${variants[variant]} ${className}`}>
      {Icon && <Icon size={18} />}
      {children}
    </button>
  );
}

function Card({ children, className = '', title, subtitle, icon: Icon }: any) {
  return (
    <div className={`bg-white border border-neutral-200 rounded-xl overflow-hidden shadow-sm ${className}`}>
      {(title || Icon) && (
        <div className="px-6 py-4 border-bottom border-neutral-100 flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-neutral-900 flex items-center gap-2">
              {Icon && <Icon size={18} className="text-neutral-500" />}
              {title}
            </h3>
            {subtitle && <p className="text-xs text-neutral-500 mt-0.5">{subtitle}</p>}
          </div>
        </div>
      )}
      <div className="p-6">{children}</div>
    </div>
  );
}

// --- Main App ---

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [premises, setPremises] = useState<Premise[]>([]);
  const [logs, setLogs] = useState<AttendanceLog[]>([]);
  const [volunteers, setVolunteers] = useState<UserProfile[]>([]);
  const [currentLocation, setCurrentLocation] = useState<Location | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'volunteer' | 'admin' | 'logs' | 'settings'>('volunteer');
  const [isExporting, setIsExporting] = useState(false);
  const [isUpdatingProfile, setIsUpdatingProfile] = useState(false);
  const [newName, setNewName] = useState('');

  useEffect(() => {
    if (profile) setNewName(profile.displayName);
  }, [profile]);

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !newName.trim()) return;
    setIsUpdatingProfile(true);
    try {
      await updateDoc(doc(db, 'volunteers', user.uid), {
        displayName: newName.trim()
      });
      // Local check update is handled by snapshot
    } catch (e) {
      handleFirestoreError(e, OperationType.UPDATE, `volunteers/${user.uid}`);
    } finally {
      setIsUpdatingProfile(false);
    }
  };

  const handleClearNotifications = async () => {
    if (!user) return;
    if (!confirm('This will stop push notifications on all your devices. Continue?')) return;
    try {
      await updateDoc(doc(db, 'volunteers', user.uid), {
        fcmTokens: {}
      });
      setNotificationPermission('default');
    } catch (e) {
      handleFirestoreError(e, OperationType.UPDATE, `volunteers/${user.uid}`);
    }
  };
  const [showNotificationPrompt, setShowNotificationPrompt] = useState(false);
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission>('default');

  // FCM Token Registration
  useEffect(() => {
    if (!user || notificationPermission !== 'granted') return;

    const setupFcm = async () => {
      try {
        const token = await getToken(messaging, {
          vapidKey: 'BD0c70fd7a9603d5c9fe7f' // This should ideally be passed from config or generated
        });

        if (token) {
          console.log('FCM Token:', token);
          // Save token to profile
          const userDocRef = doc(db, 'volunteers', user.uid);
          await updateDoc(userDocRef, {
            [`fcmTokens.${token}`]: true
          });
        }
      } catch (err) {
        console.error('Error getting FCM token:', err);
      }
    };

    setupFcm();

    const unsubscribeOnMessage = onMessage(messaging, (payload) => {
      console.log('Foreground message received:', payload);
      // You could use a toast library here. For now, we'll just log or use a simple alert/overlay if needed.
    });

    return () => unsubscribeOnMessage();
  }, [user, notificationPermission]);

  useEffect(() => {
    if ('Notification' in window) {
      setNotificationPermission(Notification.permission);
      if (Notification.permission === 'default' && user) {
        setShowNotificationPrompt(true);
      }
    }
  }, [user]);

  const requestNotificationPermission = async () => {
    if (!('Notification' in window)) return;
    const permission = await Notification.requestPermission();
    setNotificationPermission(permission);
    setShowNotificationPrompt(false);
  };

  const deletePremise = async (id: string) => {
    if (!confirm('Are you sure you want to delete this premise?')) return;
    try {
      await deleteDoc(doc(db, 'premises', id));
    } catch (e) {
      handleFirestoreError(e, OperationType.DELETE, `premises/${id}`);
    }
  };

  // 1. Auth & Profile Sync
  useEffect(() => {
    return onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        const userDocRef = doc(db, 'volunteers', u.uid);
        try {
          const userDoc = await getDoc(userDocRef);
          if (!userDoc.exists()) {
            const newProfile: UserProfile = {
              uid: u.uid,
              displayName: u.displayName || 'Anonymous',
              email: u.email || '',
              role: u.email === 'kapatel1977@gmail.com' ? 'admin' : 'volunteer',
              isInside: false,
              currentPremiseId: null
            };
            await setDoc(userDocRef, newProfile);
            setProfile(newProfile);
          } else {
            setProfile(userDoc.data() as UserProfile);
          }
        } catch (e) {
          handleFirestoreError(e, OperationType.GET, `volunteers/${u.uid}`);
        }
      } else {
        setProfile(null);
      }
      setLoading(false);
    });
  }, []);

  // 2. Real-time Data Listeners
  useEffect(() => {
    if (!user) return;

    const premisesUnsub = onSnapshot(collection(db, 'premises'), (snap) => {
      setPremises(snap.docs.map(d => ({ id: d.id, ...d.data() } as Premise)));
    }, (e) => handleFirestoreError(e, OperationType.LIST, 'premises'));

    const logsQuery = profile?.role === 'admin' 
      ? query(collection(db, 'logs'), orderBy('timestamp', 'desc'))
      : query(collection(db, 'logs'), where('volunteerId', '==', user.uid), orderBy('timestamp', 'desc'));

    const logsUnsub = onSnapshot(logsQuery, (snap) => {
      setLogs(snap.docs.map(d => ({ id: d.id, ...d.data() } as AttendanceLog)));
    }, (e) => handleFirestoreError(e, OperationType.LIST, 'logs'));

    let volunteersUnsub = () => {};
    if (profile?.role === 'admin') {
      volunteersUnsub = onSnapshot(collection(db, 'volunteers'), (snap) => {
        setVolunteers(snap.docs.map(d => d.data() as UserProfile));
      }, (e) => handleFirestoreError(e, OperationType.LIST, 'volunteers'));
    }

    return () => {
      premisesUnsub();
      logsUnsub();
      volunteersUnsub();
    };
  }, [user, profile?.role]);

  // 3. Geolocation Tracking
  useEffect(() => {
    if (!user || !profile) return;

    if (!navigator.geolocation) {
      console.error("Geolocation is not supported by this browser.");
      return;
    }

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const newLoc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setCurrentLocation(newLoc);
        checkGeofences(newLoc);
      },
      (err) => console.error("Error watching position:", err),
      { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, [user, profile, premises]);

  // Periodic Location Update (every 60 seconds)
  useEffect(() => {
    if (!user || !currentLocation) return;

    const intervalId = setInterval(async () => {
      try {
        await updateDoc(doc(db, 'volunteers', user.uid), {
          lastLocation: currentLocation,
          lastLocationUpdate: serverTimestamp()
        });
      } catch (e) {
        // Silently fail or log to console
        console.error("Failed to update last location:", e);
      }
    }, 60000); // 1 minute interval

    return () => clearInterval(intervalId);
  }, [user, currentLocation]);

  // 4. Geofence Logic
  const checkGeofences = async (loc: Location) => {
    if (!profile || premises.length === 0) return;

    let insideAny = false;
    let currentPremise: Premise | null = null;

    for (const p of premises) {
      const dist = calculateDistance(loc, p.center);
      if (dist <= p.radius) {
        insideAny = true;
        currentPremise = p;
        break;
      }
    }

    // Status changed or switched premise?
    const switchedPremise = insideAny && currentPremise?.id !== profile.currentPremiseId;
    
    if (insideAny !== profile.isInside || switchedPremise) {
      const type = insideAny ? 'entry' : 'exit';
      
      // If we switched premises, we should log exit from old one first?
      // For simplicity in this automated log, we'll just log the new entry or exit.
      
      const logData = {
        volunteerId: profile.uid,
        volunteerName: profile.displayName,
        type,
        timestamp: serverTimestamp(),
        location: loc,
        premiseId: currentPremise?.id || profile.currentPremiseId || 'unknown'
      };

      try {
        await addDoc(collection(db, 'logs'), logData);
        const updates: any = { 
          isInside: insideAny,
          currentPremiseId: insideAny ? currentPremise?.id : null 
        };
        if (insideAny) updates.lastCheckIn = serverTimestamp();
        else updates.lastCheckOut = serverTimestamp();
        
        await updateDoc(doc(db, 'volunteers', profile.uid), updates);
        setProfile(prev => prev ? { ...prev, ...updates } : null);
      } catch (e) {
        handleFirestoreError(e, OperationType.WRITE, 'logs');
      }
    }
  };

  // 5. Admin Exports
  const exportToCSV = () => {
    setIsExporting(true);
    const headers = ['Volunteer', 'Email', 'Type', 'Timestamp', 'Premise', 'Location'];
    const rows = logs.map(l => [
      l.volunteerName,
      '', // Email not in log usually for privacy, but could be joined
      l.type.toUpperCase(),
      l.timestamp ? format((l.timestamp as any).toDate(), 'yyyy-MM-dd HH:mm:ss') : '',
      premises.find(p => p.id === l.premiseId)?.name || 'Unknown',
      `${l.location.lat}, ${l.location.lng}`
    ]);

    const csvContent = [headers, ...rows].map(e => e.join(",")).join("\n");
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `volunteer_attendance_${format(new Date(), 'yyyy-MM-dd')}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setIsExporting(false);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-neutral-50">
        <motion.div 
          animate={{ rotate: 360 }} 
          transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}
          className="w-8 h-8 border-2 border-neutral-300 border-t-neutral-900 rounded-full"
        />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-neutral-50 p-4">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md w-full bg-white border border-neutral-200 rounded-2xl p-8 shadow-xl text-center"
        >
          <div className="w-16 h-16 bg-neutral-100 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <MapPin className="text-neutral-900" size={32} />
          </div>
          <h1 className="text-2xl font-bold text-neutral-900 mb-2">Volunteer Tracker</h1>
          <p className="text-neutral-500 mb-8">Sign in to automatically log your attendance via geofencing.</p>
          <Button onClick={signInWithGoogle} className="w-full" icon={LoginIcon}>
            Sign in with Google
          </Button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-50 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-neutral-200 sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-neutral-900 rounded-xl flex items-center justify-center">
              <MapPin className="text-white" size={20} />
            </div>
            <div>
              <h1 className="font-bold text-neutral-900 leading-tight">GeoVolunteer</h1>
              <p className="text-[10px] uppercase tracking-wider text-neutral-500 font-semibold font-mono">Real-time Presence</p>
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="hidden md:block text-right">
              <p className="text-sm font-medium text-neutral-900">{user.displayName}</p>
              <p className="text-xs text-neutral-500 capitalize">{profile?.role}</p>
            </div>
            <Button variant="ghost" onClick={logout} icon={LogOut}>
              <span className="hidden sm:inline">Logout</span>
            </Button>
          </div>
        </div>
      </header>

      {/* Navigation */}
      <nav className="bg-white border-b border-neutral-200">
        <div className="max-w-6xl mx-auto px-4 flex">
          <NavItem 
            id="nav-volunteer"
            active={activeTab === 'volunteer'} 
            onClick={() => setActiveTab('volunteer')} 
            icon={LayoutDashboard}
            label="My Status"
          />
          <NavItem 
            id="nav-logs"
            active={activeTab === 'logs'} 
            onClick={() => setActiveTab('logs')} 
            icon={History}
            label="Daily Logs"
          />
          <NavItem 
            id="nav-settings"
            active={activeTab === 'settings'} 
            onClick={() => setActiveTab('settings')} 
            icon={Settings}
            label="Settings"
          />
          {profile?.role === 'admin' && (
            <NavItem 
              id="nav-admin"
              active={activeTab === 'admin'} 
              onClick={() => setActiveTab('admin')} 
              icon={ShieldAlert}
              label="Admin Console"
            />
          )}
        </div>
      </nav>

      {/* Main Content */}
      <main className="flex-1 max-w-6xl w-full mx-auto p-4 md:p-6 lg:p-8">
        <AnimatePresence mode="wait">
          {activeTab === 'volunteer' && (
            <motion.div 
              key="volunteer"
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 10 }}
              className="space-y-6"
            >
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <Card className="col-span-1" title="Attendance Status" icon={UserIcon}>
                  <div className="text-center py-6">
                    <div className={`w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-4 ${profile?.isInside ? 'bg-green-50 text-green-600' : 'bg-neutral-50 text-neutral-400'}`}>
                      {profile?.isInside ? <CheckCircle2 size={40} /> : <XCircle size={40} />}
                    </div>
                    <h2 className="text-2xl font-bold text-neutral-900">
                      {profile?.isInside ? 'Currently On-Premise' : 'Off-Premise'}
                    </h2>
                    <p className="text-sm text-neutral-500 mt-2">
                       {profile?.isInside 
                         ? `Entered at ${profile.lastCheckIn ? format((profile.lastCheckIn as any).toDate(), 'HH:mm') : '--:--'}`
                         : profile?.lastCheckOut 
                           ? `Last left at ${format((profile.lastCheckOut as any).toDate(), 'HH:mm')}`
                           : 'No activity recorded today'
                       }
                    </p>
                    
                    <div className="mt-6 pt-6 border-t border-neutral-100 italic">
                      {notificationPermission === 'default' && (
                        <Button variant="secondary" onClick={requestNotificationPermission} icon={Bell} className="w-full text-xs">
                          Enable Push Notifications
                        </Button>
                      )}
                      {notificationPermission === 'granted' && (
                        <p className="text-[10px] text-green-600 flex items-center justify-center gap-1">
                          <CheckCircle2 size={12} /> Push notifications enabled
                        </p>
                      )}
                      {notificationPermission === 'denied' && (
                        <p className="text-[10px] text-red-600 flex items-center justify-center gap-1">
                          <BellOff size={12} /> Notifications blocked in browser
                        </p>
                      )}
                    </div>
                  </div>
                </Card>

                <Card className="col-span-1 md:col-span-2 overflow-hidden p-0" title="Premise Map" icon={Navigation}>
                  <div className="h-[400px] w-full bg-neutral-100 relative">
                    <MapComponent 
                      currentLocation={currentLocation} 
                      premises={premises} 
                      volunteers={volunteers}
                      interactive={false}
                    />
                    {!currentLocation && (
                      <div className="absolute inset-0 z-[1000] bg-white/50 backdrop-blur-sm flex items-center justify-center text-center p-4">
                        <div className="max-w-xs">
                          <Navigation className="mx-auto mb-2 text-neutral-400 animate-pulse" />
                          <p className="text-sm font-medium text-neutral-600">Waiting for GPS signal...</p>
                          <p className="text-xs text-neutral-400 mt-1">Make sure location permissions are granted.</p>
                        </div>
                      </div>
                    )}
                  </div>
                </Card>
              </div>
            </motion.div>
          )}

          {activeTab === 'logs' && (
            <motion.div 
              key="logs"
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 10 }}
              className="space-y-6"
            >
              <Card 
                title="Activity History" 
                icon={History}
                subtitle={profile?.role === 'admin' ? "Full organizational report" : "Your personal attendance record"}
              >
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="border-b border-neutral-100 text-xs text-neutral-500 uppercase tracking-wider">
                        <th className="py-3 px-2">Time</th>
                        <th className="py-3 px-2">Volunteer</th>
                        <th className="py-3 px-2">Type</th>
                        <th className="py-3 px-2">Premise</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-50">
                      {logs.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="py-12 text-center text-neutral-400">No activity recorded yet</td>
                        </tr>
                      ) : (
                        logs.map(log => (
                          <tr key={log.id} className="text-sm">
                            <td className="py-4 px-2 whitespace-nowrap">
                              {log.timestamp ? format((log.timestamp as any).toDate(), 'MMM d, HH:mm:ss') : 'Just now'}
                            </td>
                            <td className="py-4 px-2 font-medium">{log.volunteerName}</td>
                            <td className="py-4 px-2">
                              <span className={`px-2 py-1 rounded-full text-[10px] font-bold uppercase ${log.type === 'entry' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                                {log.type}
                              </span>
                            </td>
                            <td className="py-4 px-2 text-neutral-500">
                              {premises.find(p => p.id === log.premiseId)?.name || 'Building A'}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </Card>
            </motion.div>
          )}

          {activeTab === 'settings' && (
            <motion.div 
              key="settings"
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 10 }}
              className="space-y-6"
            >
              <div className="max-w-2xl mx-auto space-y-6">
                <Card title="Account Settings" icon={UserIcon}>
                  <form onSubmit={handleUpdateProfile} className="space-y-4">
                    <div className="space-y-1">
                      <label className="text-xs font-bold uppercase text-neutral-500">Public Display Name</label>
                      <input 
                        type="text" 
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        className="w-full px-4 py-2 bg-neutral-50 border border-neutral-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent transition-all"
                        placeholder="Your full name"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-bold uppercase text-neutral-500">Email Address</label>
                      <input 
                        type="email" 
                        value={user.email || ''} 
                        disabled 
                        className="w-full px-4 py-2 bg-neutral-100 border border-neutral-200 rounded-lg text-neutral-500 cursor-not-allowed"
                      />
                    </div>
                    <Button disabled={isUpdatingProfile || newName === profile?.displayName} className="w-full md:w-auto">
                      {isUpdatingProfile ? 'Saving...' : 'Update Profile'}
                    </Button>
                  </form>
                </Card>

                <Card title="Notification Preferences" icon={Bell}>
                  <div className="space-y-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium text-neutral-900">Push Notifications</p>
                        <p className="text-xs text-neutral-500">Receive alerts for entries and exits.</p>
                      </div>
                      <div className="flex items-center gap-2">
                        {notificationPermission === 'granted' ? (
                          <span className="text-[10px] bg-green-50 text-green-700 px-2 py-1 rounded-full font-bold uppercase">Enabled</span>
                        ) : (
                          <span className="text-[10px] bg-neutral-100 text-neutral-500 px-2 py-1 rounded-full font-bold uppercase">{notificationPermission}</span>
                        )}
                      </div>
                    </div>

                    <div className="space-y-3 pt-4 border-t border-neutral-100">
                      {notificationPermission !== 'granted' ? (
                        <Button variant="secondary" className="w-full" onClick={requestNotificationPermission} icon={Bell}>
                          Grant Browser Permission
                        </Button>
                      ) : (
                        <div className="space-y-3">
                          <p className="text-xs text-neutral-500">Your device is registered to receive notifications. You can opt-out by clearing your push tokens.</p>
                          <Button variant="danger" className="w-full" onClick={handleClearNotifications} icon={BellOff}>
                            Opt-out of all notifications
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                </Card>
              </div>
            </motion.div>
          )}

          {activeTab === 'admin' && (
            <motion.div 
              key="admin"
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 10 }}
              className="space-y-6"
            >
              <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
                <div>
                  <h2 className="text-xl font-bold">Admin Console</h2>
                  <p className="text-sm text-neutral-500">Manage premises and export data.</p>
                </div>
                <div className="flex gap-2">
                  <Button variant="secondary" onClick={exportToCSV} disabled={isExporting || logs.length === 0} icon={Download}>
                    Export CSV
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                 <Card className="lg:col-span-2" title="Define New Premise" icon={Settings}>
                    <PremiseForm premises={premises} />
                 </Card>
                 
                 <div className="space-y-6">
                   <Card title="Active Premises" icon={MapPin}>
                     <div className="space-y-4">
                       {premises.map(p => (
                         <div key={p.id} className="flex items-center justify-between p-3 bg-neutral-50 rounded-lg border border-neutral-100">
                           <div>
                             <p className="font-semibold text-sm">{p.name}</p>
                             <p className="text-[10px] text-neutral-500">{p.radius}m radius</p>
                           </div>
                           <Button variant="ghost" className="p-1 min-w-0" onClick={() => deletePremise(p.id)} icon={XCircle} />
                         </div>
                       ))}
                       {premises.length === 0 && <p className="text-center text-sm text-neutral-400 py-4">No premises defined</p>}
                     </div>
                   </Card>
                 </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      <footer className="py-8 border-t border-neutral-200 mt-auto text-center">
        <p className="text-xs text-neutral-400 font-mono">GeoVolunteer v1.0 • Built with Google AI Studio</p>
      </footer>

      {/* Modals/Overlays could go here */}
    </div>
  );
}

// --- Sub-components ---

function NavItem({ active, onClick, icon: Icon, label, id }: any) {
  return (
    <button
      id={id}
      onClick={onClick}
      className={`flex items-center gap-2 px-6 py-4 text-sm font-medium transition-all relative cursor-pointer ${active ? 'text-neutral-900' : 'text-neutral-500 hover:text-neutral-700 hover:bg-neutral-50'}`}
    >
      <Icon size={18} />
      {label}
      {active && (
        <motion.div 
          layoutId="nav-underline"
          className="absolute bottom-0 left-0 right-0 h-0.5 bg-neutral-900"
        />
      )}
    </button>
  );
}

function MapComponent({ currentLocation, premises, volunteers = [], interactive = true }: any) {
  const center = currentLocation || (premises.length > 0 ? premises[0].center : { lat: 20, lng: 0 });
  const zoom = currentLocation ? 16 : 2;

  // Icons for volunteers
  const volunteerIcon = new L.Icon({
    iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-blue.png',
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
    shadowSize: [41, 41]
  });

  const activeVolunteerIcon = new L.Icon({
    iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png',
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
    shadowSize: [41, 41]
  });

  return (
    <MapContainer center={center as L.LatLngExpression} zoom={zoom} style={{ height: '100%', width: '100%' }}>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      
      {currentLocation && (
        <Marker position={currentLocation as L.LatLngExpression}>
          <Popup>You are here</Popup>
        </Marker>
      )}

      {volunteers.filter((v: UserProfile) => v.lastLocation).map((v: UserProfile) => (
        <Marker 
          key={v.uid} 
          position={v.lastLocation as L.LatLngExpression}
          icon={v.isInside ? activeVolunteerIcon : volunteerIcon}
        >
          <Popup>
            <div className="text-xs">
              <p className="font-bold">{v.displayName}</p>
              <p>{v.isInside ? 'Inside a premise' : 'Outside'}</p>
              {v.lastLocationUpdate && (
                <p className="text-[10px] text-neutral-500">
                  Last update: {format((v.lastLocationUpdate as any).toDate(), 'HH:mm:ss')}
                </p>
              )}
            </div>
          </Popup>
        </Marker>
      ))}

      {premises.map((p: Premise) => (
        <Circle 
          key={p.id} 
          center={p.center as L.LatLngExpression} 
          radius={p.radius}
          pathOptions={{ color: '#000', fillColor: '#000', fillOpacity: 0.1 }}
        >
          <Popup>{p.name}</Popup>
        </Circle>
      ))}
    </MapContainer>
  );
}

function PremiseForm({ premises }: any) {
  const [name, setName] = useState('');
  const [radius, setRadius] = useState(50);
  const [tempLoc, setTempLoc] = useState<Location | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const markerRef = useRef<L.Marker>(null);

  const [lastSaved, setLastSaved] = useState<{ center: Location, radius: number } | null>(null);

  const MapEvents = () => {
    useMapEvents({
      click(e) {
        setTempLoc(e.latlng);
      },
    });
    return null;
  };

  function MapController({ target }: { target: { center: Location, radius: number } | null }) {
    const map = useMap();
    useEffect(() => {
      if (target) {
        const zoom = target.radius > 500 ? 15 : target.radius > 200 ? 16 : 17;
        map.flyTo(target.center as L.LatLngExpression, zoom, { duration: 1.5 });
      }
    }, [target, map]);
    return null;
  }

  const eventHandlers = useMemo(
    () => ({
      dragend() {
        const marker = markerRef.current;
        if (marker != null) {
          setTempLoc(marker.getLatLng());
        }
      },
    }),
    [],
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tempLoc || !name) return;
    setIsSubmitting(true);
    try {
      await addDoc(collection(db, 'premises'), {
        name,
        center: tempLoc,
        radius,
        createdBy: auth.currentUser?.uid,
        createdAt: serverTimestamp()
      });
      setLastSaved({ center: tempLoc, radius });
      setName('');
      setTempLoc(null);
    } catch (e) {
      handleFirestoreError(e, OperationType.WRITE, 'premises');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1">
          <label className="text-xs font-bold uppercase text-neutral-500">Premise Name</label>
          <input 
            type="text" 
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={isSubmitting}
            placeholder="Main Office"
            className="w-full px-4 py-2 bg-neutral-50 border border-neutral-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent transition-all"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-bold uppercase text-neutral-500">Radius (meters)</label>
          <input 
            type="number" 
            required
            value={radius}
            onChange={(e) => setRadius(parseInt(e.target.value))}
            disabled={isSubmitting}
            min={10}
            max={1000}
            className="w-full px-4 py-2 bg-neutral-50 border border-neutral-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent transition-all"
          />
        </div>
      </div>

      <div className="space-y-1">
        <label className="text-xs font-bold uppercase text-neutral-500">Location Selection</label>
        <p className="text-[10px] text-neutral-400 mb-2">Click to place, then drag the marker to adjust the center of the premise.</p>
        <div className="h-[300px] w-full rounded-xl overflow-hidden border border-neutral-200">
          <MapContainer center={{ lat: 0, lng: 0 }} zoom={2} style={{ height: '100%', width: '100%' }}>
            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
            <MapEvents />
            <MapController target={lastSaved} />
            {tempLoc && (
              <>
                <Marker 
                  draggable={true}
                  eventHandlers={eventHandlers}
                  position={tempLoc as L.LatLngExpression}
                  ref={markerRef}
                >
                  <Popup>Drag to adjust center</Popup>
                </Marker>
                <Circle 
                  center={tempLoc as L.LatLngExpression} 
                  radius={radius} 
                  pathOptions={{ dashArray: '5, 5', color: '#000' }} 
                />
              </>
            )}
          </MapContainer>
        </div>
      </div>

      <Button className="w-full" disabled={!tempLoc || isSubmitting || !name} icon={Plus}>
        {isSubmitting ? 'Saving...' : 'Save Premise'}
      </Button>
    </form>
  );
}

// Utility to delete premise (moved inside App)
