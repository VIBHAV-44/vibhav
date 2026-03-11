export interface BMIRecord {
  id?: string;
  userId: string;
  weight: number;
  height: number;
  bmi: number;
  category: string;
  timestamp: string;
}

export type BMICategory = 'Underweight' | 'Normal' | 'Overweight' | 'Obese';
