import { NextRequest, NextResponse } from "next/server";
import { verifyToken, listUsers, addUser, removeUser } from "@/lib/auth";

function getSession(request: NextRequest) {
  const token = request.cookies.get("session")?.value;
  if (!token) return null;
  return verifyToken(token);
}

export async function GET(request: NextRequest) {
  const session = getSession(request);
  if (!session || session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return NextResponse.json(listUsers());
}

export async function POST(request: NextRequest) {
  const session = getSession(request);
  if (!session || session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { username, password, role } = await request.json();
  if (!username || !password) {
    return NextResponse.json({ error: "Username and password required" }, { status: 400 });
  }

  const ok = await addUser(username, password, role || "viewer");
  if (!ok) {
    return NextResponse.json({ error: "User already exists" }, { status: 409 });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
  const session = getSession(request);
  if (!session || session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { username } = await request.json();
  if (username === session.username) {
    return NextResponse.json({ error: "Cannot remove yourself" }, { status: 400 });
  }

  const ok = await removeUser(username);
  if (!ok) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
