"use server";

import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { createSession, destroySession, homeFor, type Session } from "@/lib/auth";

export async function login(_: string | null, form: FormData) {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  if (!email || !password) return "Enter your email and password.";

  const db = await getDb();
  const user = await db.collection("people").findOne({ email });
  if (!user?.password_hash || !(await bcrypt.compare(password, user.password_hash))) {
    return "Email or password is incorrect.";
  }

  // Role and household link live on households.members, not on people.
  const household = await db.collection("households").findOne({ "members.user_id": user.user_id });
  const member = household?.members.find((m: { user_id: string }) => m.user_id === user.user_id);
  if (!member) return "This account isn't linked to a household yet.";

  const role = member.role as Session["role"];
  await createSession({ user_id: user.user_id, name: user.name, role, person_id: household!.person_id });
  redirect(homeFor(role));
}

export async function logout() {
  await destroySession();
  redirect("/login");
}
