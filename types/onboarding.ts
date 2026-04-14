// types/onboarding.ts
export type UserType = "patient" | "caregiver";

export type UserData = {
  userType: UserType;
  name: string;
  dateOfBirth: string;
  gender: string;
  contactInfo: {
    phone: string;
    address: string;
    emergencyContact: string;
  };
};

export type MedicalData = {
  conditions: string[];
  allergies: string[];
  drugAllergies: string[]; // ← ADDED
  medications: string[];
  bloodType: string;
  height: string;
  weight: string;
  notes: string;
  // New fields
  isPregnant: boolean;
  isBreastfeeding: boolean;
  dueDate: string;
  pregnancyNotes: string;
  smokingStatus: string;
  alcoholConsumption: string;
  exerciseFrequency: string;
  dietaryPreferences: string;
  lifestyleNotes: string;
};

export type OnboardingData = {
  userData: UserData;
  medicalData: MedicalData;
};
