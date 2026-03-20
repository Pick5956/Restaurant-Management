import { User } from "../types/auth";

export async function getCurrentUser():Promise<User | null> {
    return{
        ID: 1,
        role:"admin", 
    }
}