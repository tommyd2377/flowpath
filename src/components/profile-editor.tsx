"use client";

import { useEffect, useState } from "react";
import { Save } from "lucide-react";

import { apiFetch } from "@/lib/client-api";
import type { Profile } from "@/lib/types";
import { Button, Card, Field, Notice, PageHeader, TextArea } from "./ui";

type ProfileForm = Omit<Profile, "id" | "created_at" | "updated_at">;

const emptyProfile: ProfileForm = {
  personal_profile: "",
  current_season: "",
  core_priorities: "",
  constraints: "",
  operating_principles: "",
  remember: "",
  challenge_on: "",
};

const fields: Array<{ key: keyof ProfileForm; label: string; rows?: number }> = [
  { key: "personal_profile", label: "Personal profile", rows: 5 },
  { key: "current_season", label: "Current season of life", rows: 4 },
  { key: "core_priorities", label: "Core priorities", rows: 4 },
  { key: "constraints", label: "Constraints", rows: 4 },
  { key: "operating_principles", label: "Operating principles", rows: 4 },
  { key: "remember", label: "Things the AI should remember", rows: 5 },
  { key: "challenge_on", label: "Things the AI should challenge me on", rows: 4 },
];

export function ProfileEditor() {
  const [profile, setProfile] = useState<ProfileForm>(emptyProfile);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<Profile>("/api/profile")
      .then((data) => {
        setProfile({
          personal_profile: data.personal_profile,
          current_season: data.current_season,
          core_priorities: data.core_priorities,
          constraints: data.constraints,
          operating_principles: data.operating_principles,
          remember: data.remember,
          challenge_on: data.challenge_on,
        });
      })
      .catch((loadError) =>
        setError(loadError instanceof Error ? loadError.message : "Could not load profile."),
      )
      .finally(() => setLoading(false));
  }, []);

  async function saveProfile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const saved = await apiFetch<Profile>("/api/profile", {
        method: "PUT",
        body: JSON.stringify(profile),
      });
      setProfile({
        personal_profile: saved.personal_profile,
        current_season: saved.current_season,
        core_priorities: saved.core_priorities,
        constraints: saved.constraints,
        operating_principles: saved.operating_principles,
        remember: saved.remember,
        challenge_on: saved.challenge_on,
      });
      setMessage("Memory saved.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save profile.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <PageHeader eyebrow="Memory" title="Profile">
        <p>
          FlowPath only knows what is stored in this app. Paste durable context here so
          future plans can be grounded without relying on ChatGPT memories.
        </p>
      </PageHeader>

      {message ? <div className="mb-4"><Notice tone="success">{message}</Notice></div> : null}
      {error ? <div className="mb-4"><Notice tone="error">{error}</Notice></div> : null}

      <Card>
        {loading ? (
          <div className="text-sm text-slate-400">Loading profile...</div>
        ) : (
          <form className="grid gap-5" onSubmit={saveProfile}>
            {fields.map((field) => (
              <Field key={field.key} label={field.label}>
                <TextArea
                  rows={field.rows}
                  value={profile[field.key]}
                  onChange={(event) =>
                    setProfile((current) => ({
                      ...current,
                      [field.key]: event.target.value,
                    }))
                  }
                />
              </Field>
            ))}
            <div>
              <Button type="submit" disabled={saving}>
                <Save className="h-4 w-4" />
                {saving ? "Saving..." : "Save Memory"}
              </Button>
            </div>
          </form>
        )}
      </Card>
    </div>
  );
}
