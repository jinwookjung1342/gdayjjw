import { NextResponse } from "next/server";
import { validateEmployeeCredentials } from "@/lib/auth/employee-id";

type LoginBody = {
  employeeId?: string;
  password?: string;
};

export async function POST(request: Request) {
  const body = (await request.json()) as LoginBody;
  const result = validateEmployeeCredentials(body.employeeId ?? "", body.password ?? "");

  if (!result.isValid) {
    return NextResponse.json({ ok: false, message: result.message }, { status: 400 });
  }

  const response = NextResponse.json({ ok: true, employeeId: result.normalized });
  response.cookies.set("jb_session", result.normalized, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 8
  });

  return response;
}
