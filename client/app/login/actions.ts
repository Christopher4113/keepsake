"use server";

import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { createSession, destroySession, homeFor, type Session } from "@/lib/auth";

export async function login(_: string | null, form: FormData) {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  if (!email || !password) return "Enter your email and password.";

  const user = await (await getDb()).collection("people").findOne({ email });
  if (!user?.password_hash || !(await bcrypt.compare(password, user.password_hash))) {
    return "Email or password is incorrect.";
  }

  const { user_id, name, role, person_id } = user as unknown as Session;
  await createSession({ user_id, name, role, person_id });
  redirect(homeFor(role));
}

export async function logout() {
  await destroySession();
  redirect("/login");
}
