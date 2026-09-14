const businessCode = (value) => typeof value === 'string'
  && /^PERFORMANCE_[A-Z0-9_]+$/.test(value)
  && !/(?:^|_)(?:OK|SUCCESS|PASS)(?:_|$)/.test(value);

const validScenario = (scenario, expectedName) => scenario?.name === expectedName
  && scenario.database === 'PostgreSQL'
  && scenario.actors === 2
  && scenario.deterministicBarrierObserved === true
  && scenario.validTruths === 1
  && scenario.duplicateEvents === 0
  && scenario.lostWrites === 0
  && scenario.additionalDisclosures === 0
  && typeof scenario.loser?.accepted === 'boolean'
  && businessCode(scenario.loser.code);

export const validatePerformanceRaceMarker = (marker, expectedScenarios) => {
  if (marker?.schemaVersion !== 1
    || marker.contract !== 'PERSONNEL_PERFORMANCE_RACE_EVIDENCE_V1'
    || !Array.isArray(marker.scenarios)
    || !Array.isArray(expectedScenarios)
    || marker.scenarios.length !== expectedScenarios.length
    || new Set(expectedScenarios).size !== expectedScenarios.length
    || new Set(marker.scenarios.map(({ name }) => name)).size !== marker.scenarios.length) return false;
  return expectedScenarios.every((name) => validScenario(
    marker.scenarios.find((scenario) => scenario?.name === name), name,
  ));
};
