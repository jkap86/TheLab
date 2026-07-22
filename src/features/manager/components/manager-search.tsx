"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function ManagerSearch({ title }: { title: string }) {
  const [searched, setSearch] = useState("");
  const router = useRouter();

  const handleSearch = () => {
    const value = searched.trim();
    if (value) {
      router.push(`/manager/${encodeURIComponent(value)}/leagues`);
    }
  };

  return (
    <div>
      <h1>{title}</h1>

      <div>
        <div>
          <input
            type="text"
            placeholder="Search username..."
            value={searched}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button onClick={handleSearch}>Go</button>
        </div>
      </div>
    </div>
  );
}
