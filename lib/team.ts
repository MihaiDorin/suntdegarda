export const ADMIN_EMAIL = "pmihaidorin@gmail.com";
export const ADMIN_NAME = "Pecie Mihai";
export const INITIAL_DOCTORS = [
  { id: "doctor-pecie-mihai", name: ADMIN_NAME, administrator: true },
  { id: "doctor-mohammad-al-marazgh", name: "Mohammad Al Marazgh", administrator: false },
  { id: "doctor-pirvulescu-cristina", name: "Pirvulescu Cristina", administrator: false },
  { id: "doctor-stanila-ana", name: "Stanila Ana", administrator: false },
  { id: "doctor-toma-andrei", name: "Toma Andrei", administrator: false },
  { id: "doctor-roman-rares", name: "Roman Rares", administrator: false },
  { id: "doctor-poenaru-radu", name: "Poenaru Radu", administrator: false },
  { id: "doctor-vijiiac-cristi", name: "Vijiiac Cristi", administrator: false },
  { id: "doctor-budescu-diana", name: "Budescu Diana", administrator: false },
] as const;
export const normalizeDoctorName = (name: string) => name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("ro").replace(/\s+/g, " ").trim();
export const unclaimedEmail = (id: string) => `unclaimed-${id}@garda.invalid`;
