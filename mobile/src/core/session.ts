/**
 * Usuario actual accesible fuera de React (motor de sync, queryFns).
 * Lo actualiza AuthProvider cuando cambia la sesión.
 */
let currentUserId: string | null = null;

export const session = {
  get userId() {
    return currentUserId;
  },
  set(userId: string | null) {
    currentUserId = userId;
  },
};
