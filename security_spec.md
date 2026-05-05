# Security Specification - GeoVolunteer Tracker

## Data Invariants
1. A Volunteer profile must match the `uid` of the authenticated user.
2. An Attendance Log must correctly reference a Volunteer's `uid` and a valid Premise.
3. Only Admins can create or modify Premises.
4. Volunteers can only read their own profile and create logs for themselves.
5. Logs are immutable after creation.
6. Premise coordinates and radius must be valid numbers.

## The "Dirty Dozen" Payloads (Denial Tests)
1. **Identity Spoofing**: Attempt to create a Volunteer profile with a `uid` that doesn't match `request.auth.uid`.
2. **Role Escalation**: A volunteer attempting to update their `role` to 'admin'.
3. **Ghost Presence**: Attempting to set `isInside` to `true` without actual geolocation match (though rules can't verify geo, they can verify schema).
4. **Log Tampering**: Attempting to update a Log entry after it's been created.
5. **Premise Hijacking**: A non-admin trying to delete or update a Premise.
6. **False Timestamp**: Providing a client-side timestamp instead of `request.time`.
7. **Junk IDs**: Using a 2KB string as a Premise ID.
8. **Shadow Fields**: Adding an `isVerified: true` field to a volunteer profile not in the schema.
9. **Relational Orphan**: Creating a log for a non-existent Premise (verified via `exists`).
10. **Data Scraping**: Attempting to list all volunteers without admin privileges.
11. **PII Leak**: A user attempting to read the email of another volunteer.
12. **Boundary Escape**: Updating a premise center with a string instead of a number.

## Test Runner logic (implied in rules)
- `isValidVolunteer(data)`: Enforces `uid`, `email`, and `role` immutability for non-admins.
- `isValidPremise(data)`: Enforces numeric `lat`/`lng` and `radius`.
- `isValidLog(data)`: Enforces `volunteerId == auth.uid` and server timestamps.
