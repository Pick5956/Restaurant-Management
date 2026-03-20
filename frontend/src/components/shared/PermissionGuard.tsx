import { can } from "@/src/lib/rbac";
import { Permission, User } from "@/src/types/auth";
import { ReactNode } from "react";

interface PermissionGuardProps{
    user:User
    permission: Permission
    children: ReactNode
}

export default function PermissionGuard({
    user,
    permission,
    children
}: PermissionGuardProps){
    if (!can(user,permission)){
        return null;
    }
    return <>{children}</>
}