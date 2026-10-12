import { formatDate } from './dates';
import { DEPARTMENTS, HOSPITAL } from './policy';
import type { FollowUpPlan, ISODate, Patient, Span, DeptCode } from './types';

/*
 * The patient's follow-up slip, in English and Hindi. Built only from fields a person
 * confirmed. The clinician's return precautions are copied verbatim; nothing is generated.
 */

const BRING_HI: Record<string, string> = {
  'X-ray': 'एक्स-रे',
  ECG: 'ईसीजी',
  'MCP card': 'एमसीपी (ममता) कार्ड',
  'OPD card': 'ओपीडी कार्ड',
  'Current medicines': 'चल रही सभी दवाइयाँ',
  'All recent reports': 'हाल की सभी रिपोर्ट',
  'Old reports and prescriptions': 'पुरानी रिपोर्ट और पर्चे',
  'Discharge summary': 'डिस्चार्ज पर्ची',
  'BP record': 'बीपी का रिकॉर्ड',
  'Sugar chart': 'शुगर चार्ट',
  'Sugar report': 'शुगर रिपोर्ट',
  'Urine routine report': 'पेशाब जाँच रिपोर्ट',
  'Sputum test report': 'बलगम जाँच रिपोर्ट',
  'Biopsy report': 'बायोप्सी रिपोर्ट',
  'Ultrasound (USG) report': 'अल्ट्रासाउंड (USG) रिपोर्ट',
  'Lipid profile report': 'लिपिड प्रोफ़ाइल रिपोर्ट',
  'Thyroid (TSH) report': 'थायरॉइड (TSH) रिपोर्ट',
  'Audiometry report': 'सुनने की जाँच रिपोर्ट',
  'CT scan report': 'सीटी स्कैन रिपोर्ट',
  'MRI report': 'एमआरआई रिपोर्ट',
  'Echo report': 'इको रिपोर्ट',
};

export function bringInHindi(item: string): string {
  if (BRING_HI[item]) return BRING_HI[item];
  if (/ report$/i.test(item)) return `${item.replace(/ report$/i, '')} रिपोर्ट`;
  return item;
}

export interface SlipInput {
  patient: Patient;
  department: DeptCode;
  visitDate: ISODate;
  plan: Pick<FollowUpPlan, 'tracking' | 'dueDate' | 'windowCloses' | 'bring'>;
  precautions: Span[];
}

export interface SlipSide {
  title: string;
  comeOn: string;
  dueLine: string | null;
  latestLine: string | null;
  whereLabel: string;
  where: string;
  bringLabel: string;
  bring: string[];
  adviceLabel: string;
  cannotCome: string;
}

export interface Slip {
  regNo: string;
  name: string;
  ageSex: string;
  visit: string;
  en: SlipSide;
  hi: SlipSide;
  /** Return precautions exactly as the clinician wrote them. */
  advice: string[];
}

export function buildSlip({ patient, department, visitDate, plan, precautions }: SlipInput): Slip {
  const dept = DEPARTMENTS[department];
  const dated = plan.tracking === 'dated' && plan.dueDate !== null;
  const bring = ['OPD card', ...plan.bring.filter((b) => b !== 'OPD card')];
  return {
    regNo: patient.regNo,
    name: patient.name,
    ageSex: `${patient.age} ${patient.sex}`,
    visit: formatDate(visitDate, 'medium'),
    advice: precautions.map((p) => p.text),
    en: {
      title: `${HOSPITAL.name} · Follow-up slip`,
      comeOn: dated ? 'Come back on' : 'Follow-up',
      dueLine: dated ? formatDate(plan.dueDate!, 'full') : 'No fixed date. Come back if needed, as your doctor advised.',
      latestLine:
        dated && plan.windowCloses ? `If you cannot come that day, come by ${formatDate(plan.windowCloses, 'long')}.` : null,
      whereLabel: 'Where',
      where: `${dept.name} OPD. Go to the registration counter first.`,
      bringLabel: 'Bring with you',
      bring,
      adviceLabel: "Doctor's advice, as written",
      cannotCome: `Cannot come? Call ${HOSPITAL.deskPhone} (${HOSPITAL.deskHours}).`,
    },
    hi: {
      title: `${HOSPITAL.nameHi} · दोबारा दिखाने की पर्ची`,
      comeOn: dated ? 'दोबारा आने की तारीख' : 'दोबारा दिखाना',
      dueLine: dated ? formatDate(plan.dueDate!, 'full', 'hi') : 'कोई तय तारीख नहीं। डॉक्टर की सलाह के अनुसार ज़रूरत होने पर आएँ।',
      latestLine:
        dated && plan.windowCloses ? `उस दिन न आ सकें तो ${formatDate(plan.windowCloses, 'medium', 'hi')} तक आएँ।` : null,
      whereLabel: 'कहाँ',
      where: `${dept.nameHi} ओपीडी। पहले पंजीकरण काउंटर पर जाएँ।`,
      bringLabel: 'साथ लाएँ',
      bring: bring.map(bringInHindi),
      adviceLabel: 'डॉक्टर की सलाह (जैसी लिखी गई)',
      cannotCome: `नहीं आ सकते? फ़ोन करें: ${HOSPITAL.deskPhone} (${HOSPITAL.deskHoursHi})`,
    },
  };
}
