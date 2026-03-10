"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import styles from "./authbar.module.css";

interface Props {
  username?: string;
  role?: string;
}

export default function AuthBar({ username, role }: Props) {
  const router = useRouter();
  const [showManage, setShowManage] = useState(false);
  const [users, setUsers] = useState<{ username: string; role: string }[]>([]);
  const [newUser, setNewUser] = useState("");
  const [newPass, setNewPass] = useState("");
  const [newRole, setNewRole] = useState("viewer");

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  async function loadUsers() {
    const res = await fetch("/api/auth/users");
    if (res.ok) setUsers(await res.json());
  }

  async function toggleManage() {
    if (!showManage) await loadUsers();
    setShowManage(!showManage);
  }

  async function handleAddUser() {
    if (!newUser || !newPass) return;
    const res = await fetch("/api/auth/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: newUser, password: newPass, role: newRole }),
    });
    if (res.ok) {
      setNewUser("");
      setNewPass("");
      setNewRole("viewer");
      await loadUsers();
    }
  }

  async function handleRemoveUser(target: string) {
    await fetch("/api/auth/users", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: target }),
    });
    await loadUsers();
  }

  return (
    <div className={styles.bar}>
      <span className={styles.user}>
        {username}
        {role === "admin" && <span className={styles.role}>admin</span>}
      </span>
      <div className={styles.actions}>
        {role === "admin" && (
          <button className={styles.btn} onClick={toggleManage}>
            {showManage ? "Close" : "Users"}
          </button>
        )}
        <button className={styles.btn} onClick={handleLogout}>
          Sign out
        </button>
      </div>

      {showManage && (
        <div className={styles.panel}>
          <h3 className={styles.panelTitle}>Manage Users</h3>
          <div className={styles.userList}>
            {users.map((u) => (
              <div key={u.username} className={styles.userRow}>
                <span>
                  {u.username}{" "}
                  <span className={styles.role}>{u.role}</span>
                </span>
                {u.username !== username && (
                  <button
                    className={styles.removeBtn}
                    onClick={() => handleRemoveUser(u.username)}
                  >
                    Remove
                  </button>
                )}
              </div>
            ))}
          </div>
          <div className={styles.addForm}>
            <input
              className={styles.input}
              placeholder="Username"
              value={newUser}
              onChange={(e) => setNewUser(e.target.value)}
            />
            <input
              className={styles.input}
              placeholder="Password"
              type="password"
              value={newPass}
              onChange={(e) => setNewPass(e.target.value)}
            />
            <select
              className={styles.input}
              value={newRole}
              onChange={(e) => setNewRole(e.target.value)}
            >
              <option value="viewer">viewer</option>
              <option value="admin">admin</option>
            </select>
            <button className={styles.addBtn} onClick={handleAddUser}>
              Add
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
