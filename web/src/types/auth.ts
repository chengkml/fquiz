export type UserPublic = {
  id: string;
  email: string;
  username: string;
  status: string;
  role_codes: string[];
  permission_codes: string[];
  created_at: string;
  last_login_at: string | null;
};

export type AuthTokenResponse = {
  access_token: string;
  token_type: string;
  expires_in: number;
  user: UserPublic;
};

export type UserListResponse = {
  items: UserPublic[];
  total: number;
};
