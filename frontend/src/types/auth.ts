export type Role = "admin" | "teacher" | "student" ;

export type Permission = "view_dashborad" | "manage_users" | "edit_post";

export interface User {
  ID: number;
//   sut_id: string;
//   first_name: string;
//   last_name: string;
//   password: string;
//   birthday: string;
//   email: string;
//   address: string;
//   profile_image: string;
//   phone: string;
//   gpax?: number | null;
  role: Role
}