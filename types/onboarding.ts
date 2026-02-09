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
  medications: string[];
  bloodType: string;
  height: string;
  weight: string;
  notes: string;
};

export type OnboardingData = {
  userData: UserData;
  medicalData: MedicalData;
};

export type OnboardingStep = {
  id: number;
  title: string;
  description: string;
  component: React.ReactNode;
};
