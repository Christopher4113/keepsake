import { logout } from "./login/actions";

export function LogoutButton() {
  return (
    <form action={logout}>
      <button className="rounded border px-3 py-1 text-sm">Sign out</button>
    </form>
  );
}
