"use server";

import { redirect } from "next/navigation";
import { destroySession, homeFor, setSessionCookie } from "@/lib/auth";
import { userService, type ServiceError } from "@/lib/userService";

export async function login(_: string | null, form: FormData) {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  if (!email || !password) return "Enter your email and password.";

  let role;
  try {
    const { token, user } = await userService.login(email, password);
    await setSessionCookie(token);
    role = user.role;
  } catch (e) {
    const { status, code } = e as ServiceError;
    if (status === 401 || status === 400) return "Email or password is incorrect.";
    if (code === "no_household") return "This account isn't linked to a household yet.";
    console.error("login failed", e);
    return "Sign-in is unavailable right now. Try again in a moment.";
  }
  redirect(homeFor(role)); // outside try: redirect() works by throwing
}

export async function logout() {
  await destroySession();
  redirect("/login");
}
