import type {ReproductionSettings} from './api';
export const reproductionSections={HEAT:'REPRODUCTION_HEATS',INSEMINATION:'REPRODUCTION_INSEMINATION',
  EMBRYO_TRANSFER:'REPRODUCTION_EMBRYO_TRANSFER',PREGNANCY:'REPRODUCTION_PREGNANCIES',
  BIRTH:'REPRODUCTION_BIRTHS',LOSS:'REPRODUCTION_LOSSES'} as const;
export function reproductionSectionEnabled(settings:ReproductionSettings|null,kind:keyof typeof reproductionSections){
  return settings?.enabledSections===undefined||settings.enabledSections.includes(reproductionSections[kind]);
}
