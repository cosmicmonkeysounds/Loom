//! Wave 18 (C10) — the story the crews suites play: two hidden sides, a
//! staff caste, a prison, and story rules that count every crew event.

export const CREW_SOURCE = `# Crew Night
start: Hall
directory: everyone
majority: Night.present / 2 + 1

GROUP Hosts
  joinable: false

GROUP Red
  rival: Blue
  hidden: true

GROUP Blue
  rival: Red
  hidden: true

LOCATION Hall
LOCATION Jail
  prison: true

CHARACTER Night
  present: 0 to 100 = 0
  founded: 0 to 100 = 0
  joins: 0 to 100 = 0
  crew_joins: 0 to 100 = 0
  side_joins: 0 to 100 = 0
  recruited: 0 to 100 = 0
  left: 0 to 100 = 0

ROLE Guest
  recruits: 0 to 100 = 0

when founded for guest:
  set Night.founded = Night.founded + 1

when guest joins:
  set Night.joins = Night.joins + 1

when guest joins Red:
  set Night.side_joins = Night.side_joins + 1

when recruited for guest:
  set Night.recruited = Night.recruited + 1
  set by.recruits = by.recruits + 1

when unaligned for guest:
  set Night.left = Night.left + 1

== Hall
  setting: Hall
Narrator: The hall.
`;
