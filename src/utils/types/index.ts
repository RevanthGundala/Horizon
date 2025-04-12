import { Database } from "./db";

export type Note = Database['public']['Tables']['notes']['Row'];
export type Block = Database['public']['Tables']['blocks']['Row'];
export type Workspace = Database['public']['Tables']['workspaces']['Row'];
export type User = Database['public']['Tables']['users']['Row'];
