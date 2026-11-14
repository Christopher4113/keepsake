import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { logout } from "./login/actions";

export function LogoutButton({ className }: { className?: string }) {
  return (
    <form action={logout}>
      <Button variant="ghost" size="sm" className={className}><LogOut /> Sign out</Button>
    </form>
  );
}
