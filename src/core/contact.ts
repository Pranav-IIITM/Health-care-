import { addDays, formatDate } from './dates';
import { HOSPITAL, nextOpdDay } from './policy';
import { effectiveDue } from './tracking';
import type { Channel, FollowUp, ISODate, Lang, Patient } from './types';

/*
 * Every outgoing text comes from a fixed, human-approved template. Templates never name
 * the department, a test, a diagnosis or the clinician's words: a shared household phone
 * must not learn why someone visits the hospital.
 */

export type MessageKind = 'reminder' | 'missed';

export interface DraftMessage {
  to: string;
  audience: 'patient' | 'household';
  lang: Lang;
  template: string;
  text: string;
}

export function firstName(name: string): string {
  return name.split(/\s+/)[0] ?? name;
}

export function maskPhone(phone: string | null): string {
  if (!phone) return '—';
  const d = phone.replace(/\D/g, '');
  return `•••••• ${d.slice(-4)}`;
}

export function formatPhone(phone: string | null): string {
  if (!phone) return '—';
  const d = phone.replace(/\D/g, '');
  return d.length === 10 ? `${d.slice(0, 5)} ${d.slice(5)}` : phone;
}

const TEMPLATES: Record<string, Record<Lang, (v: { first: string; date: string }) => string>> = {
  reminder_personal: {
    en: ({ first, date }) =>
      `${HOSPITAL.name}: Namaste ${first}. Your follow-up visit is on ${date}. Please bring your OPD card and reports. Questions: ${HOSPITAL.deskPhone}`,
    hi: ({ first, date }) =>
      `${HOSPITAL.nameHi}: नमस्ते ${first} जी, आपको ${date} को दोबारा दिखाने आना है। कृपया ओपीडी कार्ड और रिपोर्ट साथ लाएँ। जानकारी: ${HOSPITAL.deskPhone}`,
  },
  reminder_household: {
    en: ({ first, date }) =>
      `${HOSPITAL.name}: This message is for ${first}. Their hospital visit is on ${date}. Please bring the OPD card. Questions: ${HOSPITAL.deskPhone}`,
    hi: ({ first, date }) =>
      `${HOSPITAL.nameHi}: यह संदेश ${first} जी के लिए है। उन्हें ${date} को अस्पताल आना है। कृपया ओपीडी कार्ड साथ लाएँ। जानकारी: ${HOSPITAL.deskPhone}`,
  },
  missed_personal: {
    en: ({ first, date }) =>
      `${HOSPITAL.name}: Namaste ${first}. Your follow-up visit was due on ${date}. Please come to the registration counter with your OPD card, or call ${HOSPITAL.deskPhone}.`,
    hi: ({ first, date }) =>
      `${HOSPITAL.nameHi}: नमस्ते ${first} जी, आपको ${date} को दोबारा दिखाने आना था। कृपया ओपीडी कार्ड लेकर पंजीकरण काउंटर पर आएँ या ${HOSPITAL.deskPhone} पर फ़ोन करें।`,
  },
  missed_household: {
    en: ({ first }) =>
      `${HOSPITAL.name}: Message for ${first}. Please ask them to come to the hospital registration counter with the OPD card, or call ${HOSPITAL.deskPhone}.`,
    hi: ({ first }) =>
      `${HOSPITAL.nameHi}: यह संदेश ${first} जी के लिए है। कृपया उन्हें ओपीडी कार्ड लेकर पंजीकरण काउंटर पर आने या ${HOSPITAL.deskPhone} पर फ़ोन करने को कहें।`,
  },
};

export function draftMessage(kind: MessageKind, fu: FollowUp, p: Patient, channel: Channel): DraftMessage | null {
  const viaCaregiver = channel === 'caregiver';
  const to = viaCaregiver ? p.caregiver?.phone ?? null : p.phone;
  if (!to) return null;
  const household = viaCaregiver || p.phoneOwner === 'shared';
  const template = `${kind}_${household ? 'household' : 'personal'}`;
  const due = effectiveDue(fu) ?? fu.plan.dueDate;
  const date = due ? formatDate(due, 'medium', p.language) : '';
  return {
    to,
    audience: household ? 'household' : 'patient',
    lang: p.language,
    template,
    text: TEMPLATES[template][p.language]({ first: firstName(p.name), date }),
  };
}

export interface ScriptStep {
  when: string;
  say: string | null;
  then: string | null;
}

/** Fixed call script. Staff never give clinical advice; anything clinical goes to a nurse. */
export function callScript(fu: FollowUp, p: Patient, channel: Channel, today: ISODate): ScriptStep[] {
  const due = effectiveDue(fu) ?? fu.plan.dueDate;
  const suggest = nextOpdDay(addDays(today, 1), fu.department);
  const household = channel === 'caregiver' || p.phoneOwner === 'shared';
  const steps: ScriptStep[] = [
    {
      when: 'Open',
      say: `Namaste, I am calling from ${HOSPITAL.name}, follow-up desk. Am I speaking with ${p.name}?`,
      then: null,
    },
  ];
  if (household) {
    steps.push({
      when: channel === 'caregiver' ? `Speaking with ${p.caregiver?.name ?? 'the caregiver'}` : 'Someone else answers',
      say: `I have a message for ${firstName(p.name)} about a hospital visit. When can I speak with them?`,
      then: 'Do not mention the department, tests or illness to anyone except the patient or the consented caregiver.',
    });
  }
  steps.push(
    {
      when: 'With the patient',
      say: `Your follow-up visit was due on ${due ? formatDate(due, 'long') : 'an earlier date'}. Your clinic's next OPD day is ${formatDate(suggest, 'long')}. Can you come then? Please bring your OPD card${fu.plan.bring.length ? ' and reports' : ''}.`,
      then: 'If they agree, log "Reached, will come" with the date.',
    },
    {
      when: 'Questions about illness, medicines or new symptoms',
      say: 'I will ask a nurse to call you back today.',
      then: 'Log "Reached, has a clinical question". It goes to the nurse.',
    },
    {
      when: 'They say they are very unwell now',
      say: `Please go to the nearest emergency department or call ${HOSPITAL.emergencyNumber}.`,
      then: 'Log the call and escalate to the nurse.',
    },
  );
  return steps;
}
