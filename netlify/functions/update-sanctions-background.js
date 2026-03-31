// netlify/functions/update-sanctions-background.js
// Background Function — triggers GitHub Actions to run update_sanctions.py

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const GITHUB_REPO  = "GitIsDaShit/sanctions-screening";

async function updateJob(jobId, status, message) {
  if (!jobId) return;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/update_job?id=eq.${jobId}`, {
      method: "PATCH",
      headers: {
        "apikey": SUPABASE_KEY,
        "Authorization": `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        status,
        message,
        completed_at: status !== "running" ? new Date().toISOString() : null,
      }),
    });
  } catch (e) {
    console.error("Could not update job status:", e.message);
  }
}

export default async (req) => {
  console.log("update-sanctions-background started");

  if (!GITHUB_TOKEN) {
    console.error("Missing GITHUB_TOKEN");
    await updateJob(null, "error", "Missing GITHUB_TOKEN environment variable");
    return;
  }

  let source = "ALL";
  let jobId  = null;
  try {
    const body = await req.json();
    source = body.source || "ALL";
    jobId  = body.jobId  || null;
  } catch (e) {}

  console.log(`Triggering GitHub Actions for source: ${source}, jobId: ${jobId}`);
  await updateJob(jobId, "running", `Triggering GitHub Actions for ${source}...`);

  try {
    const res = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/actions/workflows/update-sanctions.yml/dispatches`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${GITHUB_TOKEN}`,
          "Accept": "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ref: "main",
          inputs: {
            source,
            job_id: jobId || "",
          },
        }),
      }
    );

    if (res.status === 204) {
      console.log("GitHub Actions workflow triggered successfully");
      await updateJob(jobId, "running", `GitHub Actions started — running update_sanctions.py --source ${source}`);
    } else {
      const text = await res.text();
      console.error("GitHub API error:", res.status, text);
      await updateJob(jobId, "error", `Failed to trigger GitHub Actions: ${res.status} ${text}`);
    }
  } catch (err) {
    console.error("Error triggering GitHub Actions:", err.message);
    await updateJob(jobId, "error", `Error: ${err.message}`);
  }
};

export const config = { type: "async" };
