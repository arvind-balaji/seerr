import type {
  Diagnosis,
  DiagnosisSearchSummary,
} from '@server/lib/diagnostics/types';

const stripSearch = (
  search?: DiagnosisSearchSummary
): DiagnosisSearchSummary | undefined =>
  search && {
    ...search,
    topReasons: [],
    bestAlternative: search.bestAlternative && {
      ...search.bestAlternative,
      title: undefined,
    },
  };

/** A diagnosis without release names, raw rejections or *arr messages. */
export const stripDiagnosis = (
  diagnosis?: Diagnosis | null
): Diagnosis | null | undefined =>
  diagnosis && {
    ...diagnosis,
    message: undefined,
    search: stripSearch(diagnosis.search),
    seasons: diagnosis.seasons?.map((s) => ({
      ...s,
      search: stripSearch(s.search),
    })),
    actions: diagnosis.actions?.map((a) => ({
      ...a,
      previousProfileId: undefined,
    })),
  };
