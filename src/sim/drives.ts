/**
 * Ready-made test drives in and around Kuala Lumpur that show the junction views at their best:
 * ramps climbing onto elevated expressways, descents to street level, underpasses and tunnels.
 * Each one is a trip link (see src/trip/tripLink.ts), so it plans the route with the normal
 * router (or the offline maps) and starts the simulator.
 */
export interface TestDrive {
  id: string;
  title: string;
  /** One line on what the drive shows. */
  summary: string;
  /** Trip link query (without the leading "?"). */
  link: string;
  /** What kinds of junction heights to expect, for the list and for checks on real data. */
  shows: ('flyover' | 'descend' | 'underpass' | 'tunnel' | 'ascend')[];
}

export const KL_DRIVES: TestDrive[] = [
  {
    id: 'suke',
    title: 'Sungai Besi toll to SUKE and KLCC',
    summary: 'Through the Sungai Besi toll plaza, up the ramps onto the elevated SUKE, then into the city.',
    link: 'from=road:E37|E2~3&via=Plaza Tol Sungai Besi@auto&via=road:E19|SUKE&to=Suria KLCC&sim=2',
    shows: ['flyover', 'descend'],
  },
  {
    id: 'dash',
    title: 'DASH and Penchala Link to Mont Kiara',
    summary: 'The elevated Damansara–Shah Alam Expressway into the multi-level Damansara interchange.',
    link: 'from=road:E31|DASH~7&to=Mont Kiara&sim=2',
    shows: ['flyover', 'descend'],
  },
  {
    id: 'mex',
    title: 'MEX into Jalan Tun Razak',
    summary: 'North on MEX into the stacked Kampung Pandan interchange and on to KLCC.',
    link: 'from=road:E20|MEX~7&to=Suria KLCC&sim=2',
    shows: ['flyover', 'descend', 'underpass'],
  },
  {
    id: 'duke',
    title: 'DUKE from Sentul to Ulu Klang',
    summary: 'The Duta–Ulu Klang Expressway past the Sentul, Setiawangsa and Ulu Klang interchanges.',
    link: 'from=road:E33|DUKE~9&to=Zoo Negara&sim=2',
    shows: ['flyover', 'descend'],
  },
  {
    id: 'akleh',
    title: 'AKLEH into KLCC',
    summary: 'Along the elevated Ampang highway and down the ramp to street level at Jalan Tun Razak.',
    link: 'from=road:E12|AKLEH~4&to=Suria KLCC&sim=2',
    shows: ['descend'],
  },
  {
    id: 'smart',
    title: 'SMART tunnel to Bukit Bintang',
    summary: 'From the Sungai Besi toll down into the SMART tunnel and out near Jalan Tun Razak.',
    link: 'from=road:E37|E2~3&via=Plaza Tol Sungai Besi@auto&via=road:E38|SMART&to=Pavilion Kuala Lumpur&sim=2',
    shows: ['tunnel'],
  },
];

export function driveQuery(d: TestDrive): string {
  return `?${d.link}`;
}
