export interface UserIdentity {
  id: string;
  email?: string;
  displayName?: string;
  roles: string[];
}

export interface Entitlement {
  id: string;
  feature: string;
  allowed: boolean;
}
