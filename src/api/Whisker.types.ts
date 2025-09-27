// Axios Device Types

export interface whiskerResponse {
  data: {
    query: Robot[];
  };
}

export interface Robot {
  serial: string;
  name: string;
  isNightLightLEDOn?: boolean;          // sometimes omitted in smaller queries
  robotStatus?: string;                  // we normalize this downstream
  catDetect?: boolean | number | string | null; // API can vary; we coerce to boolean where needed
  DFILevelPercent?: number | null;       // drawer fill % may be null
}
