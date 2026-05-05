import { Timestamp } from 'firebase/firestore';

export interface Location {
  lat: number;
  lng: number;
}

export interface Premise {
  id: string;
  name: string;
  center: Location;
  radius: number; // in meters
  createdBy: string;
  createdAt: Timestamp;
}

export interface UserProfile {
  uid: string;
  displayName: string;
  email: string;
  role: 'volunteer' | 'admin';
  isInside?: boolean;
  currentPremiseId?: string | null;
  lastCheckIn?: Timestamp;
  lastCheckOut?: Timestamp;
  fcmTokens?: Record<string, boolean>;
  lastLocation?: Location;
  lastLocationUpdate?: Timestamp;
}

export interface AttendanceLog {
  id: string;
  volunteerId: string;
  volunteerName: string;
  type: 'entry' | 'exit';
  timestamp: Timestamp;
  location: Location;
  premiseId: string;
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
  };
}
