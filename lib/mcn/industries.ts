// Industri TikTok GO (hospitality/lifestyle) — dipakai lintas modul (kreator, merchant,
// project, acquisition) sebagai satu sumber. Bukan file "use server", jadi boleh
// diimpor dari server actions maupun client component.
export const INDUSTRIES = ["Dining", "Accommodation", "Things to Do"] as const;
export type Industry = (typeof INDUSTRIES)[number];
