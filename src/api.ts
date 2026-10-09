export async function api(action: string, values: Record<string, unknown> = {}) {
  const response = await fetch("/api/garda", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Garda-Request": "1" },
    body: JSON.stringify({ action, ...values }),
  });
  const result = await response.json() as { error?: string; message?: string; link?: string; id?: string; ok?: boolean };
  if (!response.ok) throw new Error(result.error || "Operația nu a putut fi finalizată.");
  return result;
}
