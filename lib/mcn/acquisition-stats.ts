// Statistik Dashboard Performa Akuisisi (/acquisition/dashboard).
// Pure function — di-QC lewat scripts/qc_acquisition.mjs. Definisi (DECISIONS 2026-11-06):
//   Scouting = prospek baru di periode, dikreditkan ke PIC-nya:
//              · creator_prospects.created_at → owner_id (PIC Acquisition), dan
//              · mcn_creators yang DIBUAT staf Acquisition (form "Daftarkan Prospek")
//                → created_by, KECUALI kreator hasil tautan prospek (sudah dihitung
//                dari creator_prospects — tidak dobel).
//   Binding  = acquisitions dengan binding_date di periode → specialist_id.
//   CR       = Binding ÷ Scouting periode yang sama (rasio aktivitas, bukan kohort).
//   GMV      = Σ gmv_post_join (aktual, isi via "Refresh GMV") & Σ gmv_potential.

export type ProspectIn = { owner_id: string | null; created_at: string; matched_mcn_creator_id: string | null };
export type CreatorIn = { id: string; created_by: string | null; created_at: string };
export type AcqIn = {
  specialist_id: string;
  binding_date: string;
  lead_source: string | null;
  gmv_potential: number | null;
  gmv_post_join: number | null;
};

export type PersonStats = {
  id: string; // "" = belum ada PIC
  scouting: number;
  binding: number;
  cr: number | null; // persen, 1 desimal
  gmv_actual: number;
  gmv_potential: number;
};

// timestamptz → tanggal kalender WIB (YYYY-MM-DD).
export function wibYMD(ts: string): string {
  const t = Date.parse(ts);
  if (Number.isNaN(t)) return ts.slice(0, 10);
  return new Date(t + 7 * 3600 * 1000).toISOString().slice(0, 10);
}

function inRange(ymd: string, from: string, to: string) {
  return ymd >= from && ymd <= to;
}

export function crPct(binding: number, scouting: number): number | null {
  if (scouting <= 0) return null;
  return Math.round((binding / scouting) * 1000) / 10;
}

export function computeAcquisitionStats(input: {
  prospects: ProspectIn[];
  creators: CreatorIn[];
  acquisitions: AcqIn[];
  acqStaffIds: string[];
  // Kreator hasil tautan prospek di luar `prospects` (mis. prospek di luar periode).
  linkedCreatorIds?: string[];
  from: string;
  to: string;
  specialist?: string | null; // filter individu
  leadSource?: string | null; // filter sumber lead (hanya berlaku ke Binding)
}): { team: PersonStats; people: PersonStats[] } {
  const { from, to } = input;
  const staff = new Set(input.acqStaffIds);
  const linked = new Set([
    ...input.prospects.map((p) => p.matched_mcn_creator_id).filter((v): v is string => !!v),
    ...(input.linkedCreatorIds ?? []),
  ]);
  const rows = new Map<string, PersonStats>();
  const row = (id: string) => {
    let r = rows.get(id);
    if (!r) {
      r = { id, scouting: 0, binding: 0, cr: null, gmv_actual: 0, gmv_potential: 0 };
      rows.set(id, r);
    }
    return r;
  };
  for (const id of input.acqStaffIds) row(id);

  for (const p of input.prospects) {
    if (inRange(wibYMD(p.created_at), from, to)) row(p.owner_id ?? "").scouting++;
  }
  for (const c of input.creators) {
    if (!c.created_by || !staff.has(c.created_by) || linked.has(c.id)) continue;
    if (inRange(wibYMD(c.created_at), from, to)) row(c.created_by).scouting++;
  }
  for (const a of input.acquisitions) {
    if (!inRange(a.binding_date, from, to)) continue;
    if (input.leadSource && a.lead_source !== input.leadSource) continue;
    const r = row(a.specialist_id);
    r.binding++;
    r.gmv_actual += Number(a.gmv_post_join ?? 0);
    r.gmv_potential += Number(a.gmv_potential ?? 0);
  }

  let people = [...rows.values()];
  if (input.specialist) people = people.filter((p) => p.id === input.specialist);
  // Baris "belum ada PIC" hanya tampil bila ada isinya.
  people = people.filter((p) => p.id !== "" || p.scouting + p.binding > 0);
  for (const p of people) p.cr = crPct(p.binding, p.scouting);
  people.sort((a, b) => b.binding - a.binding || b.scouting - a.scouting || a.id.localeCompare(b.id));

  const team: PersonStats = { id: "team", scouting: 0, binding: 0, cr: null, gmv_actual: 0, gmv_potential: 0 };
  for (const p of people) {
    team.scouting += p.scouting;
    team.binding += p.binding;
    team.gmv_actual += p.gmv_actual;
    team.gmv_potential += p.gmv_potential;
  }
  team.cr = crPct(team.binding, team.scouting);
  return { team, people };
}
