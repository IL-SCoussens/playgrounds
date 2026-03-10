import fs from "fs";
import path from "path";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const USERS_FILE = path.join(process.cwd(), "users.json");
const JWT_SECRET = process.env.JWT_SECRET || "intellilake-playgrounds-dev-secret";
const TOKEN_EXPIRY = "24h";

export interface User {
  username: string;
  passwordHash: string;
  role: string;
}

export interface SessionPayload {
  username: string;
  role: string;
}

function readUsers(): User[] {
  return JSON.parse(fs.readFileSync(USERS_FILE, "utf-8"));
}

function writeUsers(users: User[]) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2) + "\n");
}

export async function authenticate(
  username: string,
  password: string
): Promise<SessionPayload | null> {
  const users = readUsers();
  const user = users.find((u) => u.username === username);
  if (!user) return null;

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) return null;

  return { username: user.username, role: user.role };
}

export function createToken(payload: SessionPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: TOKEN_EXPIRY });
}

export function verifyToken(token: string): SessionPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as SessionPayload;
  } catch {
    return null;
  }
}

export async function addUser(
  username: string,
  password: string,
  role: string = "viewer"
): Promise<boolean> {
  const users = readUsers();
  if (users.some((u) => u.username === username)) return false;

  const passwordHash = await bcrypt.hash(password, 10);
  users.push({ username, passwordHash, role });
  writeUsers(users);
  return true;
}

export function listUsers(): { username: string; role: string }[] {
  return readUsers().map(({ username, role }) => ({ username, role }));
}

export async function removeUser(username: string): Promise<boolean> {
  const users = readUsers();
  const filtered = users.filter((u) => u.username !== username);
  if (filtered.length === users.length) return false;
  writeUsers(filtered);
  return true;
}
