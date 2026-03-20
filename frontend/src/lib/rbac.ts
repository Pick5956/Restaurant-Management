import { Permission, Role, User } from "../types/auth";



export const rolePermissions: Record<Role,Permission[]> = {
    admin: ["view_dashborad","manage_users","edit_post"],
    teacher:["edit_post","view_dashborad"],
    student:["view_dashborad"]
}

// export function hasPermission(role: Role,permission: Permission): boolean{
//     return rolePermissions[role].includes(permission)
// }

export function can(user: User,permission: Permission): boolean{
    return rolePermissions[user.role].includes(permission)
}

