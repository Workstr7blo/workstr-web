// Where Workstr itself is supported. A Monero address is not Nostr metadata, so it cannot
// be resolved from a profile, and the operator's own `kind:10133` target belongs to creator
// tipping rather than to Workstr. So it is a constant, written down once, and validated
// before anything renders a payment code from it. The donate section on workstr.fit shows
// the same address and has to change with it.
export const OPERATOR_MONERO_ADDRESS =
  '43SH87nCju4L58vNbzrM88aSQ1yughBNvBzNauUkT71jNzv7rvdPcqpKRY94VUdEGJXbJs5dshSaNi4jAb9x96ecLid3rQq';
