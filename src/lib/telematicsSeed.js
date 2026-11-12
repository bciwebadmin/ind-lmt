// Starter critical code list for the Telematics module (Nov 2026).
//
// Built from Tanner's "Critical Code Log" — 5,019 Bobcat critical-fault
// emails, 2026-06-17 to 2026-11-12. Every code arrives labelled CRITICAL by Bobcat;
// which ones truly are is for Tanner and a technician to decide, so the app
// loads these as Critical and *not reviewed* (Erin: unreviewed = critical).
// seenCount / topModels / lastSeen describe the log, to help that review.
//
// Loaded once from Telematics → Code List ("Load starter list"); after that the
// list lives in Firestore (telematicsCodes) and this file is not read again.
// Generated — do not hand-edit; regenerate from the log if it is ever re-run.
export const TELEMATICS_SEED_SOURCE = {"rows": 5019, "from": "2026-06-17", "to": "2026-11-12"};

export const TELEMATICS_SEED_CODES = [
  {"code": "C1047-00", "summary": "Tilt Actuator Uncommanded Motion", "seenCount": 743, "topModels": ["T66", "T76", "T64"], "lastSeen": "2026-11-11"},
  {"code": "M0217", "summary": "Hydraulic/Hydrostatic Filter Plugged", "seenCount": 632, "topModels": ["T770 T4", "T740 T4", "S850 T4"], "lastSeen": "2026-11-11"},
  {"code": "E00009818", "summary": "Check Engine Oil Level Immediately", "seenCount": 429, "topModels": ["T66", "T64", "T76"], "lastSeen": "2026-11-11"},
  {"code": "P1061-97", "summary": "Air Filter Plugged", "seenCount": 215, "topModels": ["T66", "T86", "T76"], "lastSeen": "2026-11-12"},
  {"code": "M0710", "summary": "Hydraulic Oil Temperature Too High", "seenCount": 191, "topModels": ["T770 T4", "S740 T4", "S650 T4"], "lastSeen": "2026-11-04"},
  {"code": "M0810", "summary": "Engine Coolant Temperature Too High", "seenCount": 154, "topModels": ["T770 T4", "T870 T4", "S740 T4"], "lastSeen": "2026-11-11"},
  {"code": "U1010-08", "summary": "Primary Keypad No Communication", "seenCount": 151, "topModels": ["T66", "T64", "T62 T4"], "lastSeen": "2026-11-11"},
  {"code": "M1210", "summary": "Air Inlet Temperature High", "seenCount": 139, "topModels": ["T770 T4", "T870 T4", "S850 T4"], "lastSeen": "2026-11-03"},
  {"code": "M0811", "summary": "Engine Coolant Temperature Extremely High", "seenCount": 120, "topModels": ["T770 T4", "E35-25HP", "T595 T4"], "lastSeen": "2026-11-11"},
  {"code": "M5811", "summary": "Fuel Temperature Extremely High", "seenCount": 117, "topModels": ["T770 T4", "T740", "S740 T4"], "lastSeen": "2026-10-26"},
  {"code": "P1130-F8", "summary": "Fuel Filter Inlet Pressure Extremely Low", "seenCount": 115, "topModels": ["T66", "T64", "T76"], "lastSeen": "2026-11-11"},
  {"code": "E00009731", "summary": "Water in Fuel Detected", "seenCount": 112, "topModels": ["T770 T4", "E85 T4", "T595 T4"], "lastSeen": "2026-11-10"},
  {"code": "E00107616", "summary": "Rail Pressure Control Fault", "seenCount": 110, "topModels": ["T770 T4", "T740 T4", "S570 T4"], "lastSeen": "2026-11-11"},
  {"code": "M0117", "summary": "Air Filter Plugged", "seenCount": 104, "topModels": ["T770 T4", "S650 T4", "T870 T4"], "lastSeen": "2026-11-09"},
  {"code": "M0509", "summary": "Hydraulic Charge Pressure Low", "seenCount": 96, "topModels": ["T595 T4", "T740 T4", "S595 T4"], "lastSeen": "2026-11-10"},
  {"code": "M0711", "summary": "Hydraulic Oil Temperature Extremely High", "seenCount": 76, "topModels": ["T770 T4", "S740 T4", "T595 T4"], "lastSeen": "2026-11-01"},
  {"code": "M0314", "summary": "System Voltage Extremely Low", "seenCount": 63, "topModels": ["T770 T4", "T870 T4", "E26R"], "lastSeen": "2026-11-11"},
  {"code": "E00009703", "summary": "Water in Fuel Sensor Fault", "seenCount": 56, "topModels": ["T770 T4", "T66", "T740 T4"], "lastSeen": "2026-11-06"},
  {"code": "M0715", "summary": "Hydraulic Oil Temperature Shutdown", "seenCount": 56, "topModels": ["T770 T4", "S740 T4", "T595 T4"], "lastSeen": "2026-11-01"},
  {"code": "M0514", "summary": "Hydraulic Charge Pressure Extremely Low", "seenCount": 53, "topModels": ["T740 T4", "T770 T4", "T650 T4"], "lastSeen": "2026-10-27"},
  {"code": "P1062-00", "summary": "Air Filter Plugged", "seenCount": 53, "topModels": ["T66", "T86", "T62 T4"], "lastSeen": "2026-11-11"},
  {"code": "M0921", "summary": "Fuel Level Out of Range High", "seenCount": 52, "topModels": ["T740 T4", "S650 T4", "T595 T4"], "lastSeen": "2026-11-03"},
  {"code": "E00017403", "summary": "Fuel Temp Sensor Fault", "seenCount": 49, "topModels": ["T770 T4", "T770", "T650 T4"], "lastSeen": "2026-11-10"},
  {"code": "M0145", "summary": "Air Filter Derate Level 2", "seenCount": 46, "topModels": ["T770 T4", "T595 T4", "S650 T4"], "lastSeen": "2026-11-06"},
  {"code": "M0515", "summary": "Hydraulic Charge Pressure Shutdown", "seenCount": 45, "topModels": ["T740 T4", "T650 T4", "T770 T4"], "lastSeen": "2026-10-27"},
  {"code": "M1211", "summary": "Air Inlet Temperature Extremely High", "seenCount": 45, "topModels": ["T770 T4", "T870 T4"], "lastSeen": "2026-10-21"},
  {"code": "M3304", "summary": "Deluxe Panel (MSeries) No Communication", "seenCount": 45, "topModels": ["T770 T4", "T870 T4", "T770"], "lastSeen": "2026-11-09"},
  {"code": "U00433707", "summary": "Dosing Valve Tip Temperature Fault", "seenCount": 45, "topModels": ["T770 T4", "S770 T4", "T770"], "lastSeen": "2026-11-03"},
  {"code": "U00336105", "summary": "Dosing Valve Short to Battery", "seenCount": 44, "topModels": ["T770 T4"], "lastSeen": "2026-11-11"},
  {"code": "C10C5-77", "summary": "Left Swash Plate Commanded Position Not Reachable", "seenCount": 43, "topModels": ["T66", "T62 T4", "T86"], "lastSeen": "2026-10-27"},
  {"code": "E00063602", "summary": "Crank position sensor fault", "seenCount": 43, "topModels": ["E48", "E60", "T66-2"], "lastSeen": "2026-11-10"},
  {"code": "E00009723", "summary": "Water in Fuel Detected - Derate", "seenCount": 38, "topModels": ["T62 T4", "T66", "T76"], "lastSeen": "2026-11-12"},
  {"code": "M0815", "summary": "Engine Coolant Temperature Shutdown", "seenCount": 38, "topModels": ["T770 T4", "T595 T4", "T870 T4"], "lastSeen": "2026-11-09"},
  {"code": "C10C0-77", "summary": "Right Swash Plate Commanded Position Not Reachable", "seenCount": 34, "topModels": ["T66", "T62 T4", "T76"], "lastSeen": "2026-10-23"},
  {"code": "M9314", "summary": "Fuel Pressure Extremely Low", "seenCount": 32, "topModels": ["E60", "E55", "E48"], "lastSeen": "2026-11-10"},
  {"code": "P1063-00", "summary": "Air Filter Plugged", "seenCount": 32, "topModels": ["T66", "T86", "S62"], "lastSeen": "2026-11-01"},
  {"code": "M0144", "summary": "Air Filter Derate Level 1", "seenCount": 30, "topModels": ["T770 T4", "T595 T4", "S650 T4"], "lastSeen": "2026-11-06"},
  {"code": "E00008107", "summary": "SCR Fault", "seenCount": 28, "topModels": ["T770 T4", "S850 T4", "T770"], "lastSeen": "2026-11-07"},
  {"code": "B1060-09", "summary": "Lift Pedal Failure", "seenCount": 24, "topModels": ["T66", "T64", "S62"], "lastSeen": "2026-10-19"},
  {"code": "H4721", "summary": "Sensor Supply 1 Out of Range High", "seenCount": 24, "topModels": ["S650 T4", "T770 T4"], "lastSeen": "2026-11-05"},
  {"code": "B1062-16", "summary": "Lift Pedal Position Sensor &quot;B&quot; Out of Range Low", "seenCount": 23, "topModels": ["T66", "S62"], "lastSeen": "2026-10-19"},
  {"code": "M4903", "summary": "Rear Light Relay Error Off", "seenCount": 23, "topModels": ["S650 T4", "T595 T4", "T870 T4"], "lastSeen": "2026-11-10"},
  {"code": "M6202", "summary": "Tailgate Fan 1 Error On", "seenCount": 23, "topModels": ["T770 T4", "T870 T4", "T770"], "lastSeen": "2026-11-10"},
  {"code": "B1005-00", "summary": "Key Switch Multiple", "seenCount": 22, "topModels": ["T66", "T76", "T64"], "lastSeen": "2026-11-04"},
  {"code": "M8899", "summary": "Engine Disabled", "seenCount": 22, "topModels": ["E35-33HP", "E35", "T650"], "lastSeen": "2026-11-10"},
  {"code": "M4803", "summary": "Front Light Relay Error Off", "seenCount": 20, "topModels": ["T595 T4", "T870 T4"], "lastSeen": "2026-10-29"},
  {"code": "M6302", "summary": "Tailgate Fan 2 Error On", "seenCount": 20, "topModels": ["T770 T4", "T870 T4", "T770"], "lastSeen": "2026-11-10"},
  {"code": "E00524622", "summary": "SCR Inducement - Dosing Interrupted", "seenCount": 18, "topModels": ["T770 T4", "T870 T4", "T770"], "lastSeen": "2026-10-29"},
  {"code": "B1072-16", "summary": "Tilt Pedal Position Sensor &quot;B&quot; Out of Range High", "seenCount": 17, "topModels": ["T66"], "lastSeen": "2026-11-09"},
  {"code": "C1042-00", "summary": "Lift Actuator Uncommanded Motion", "seenCount": 17, "topModels": ["T76", "T66"], "lastSeen": "2026-11-10"},
  {"code": "U00437604", "summary": "DEF Backflow Pump Short to Ground", "seenCount": 17, "topModels": ["T770 T4", "T870 T4", "T770"], "lastSeen": "2026-11-08"},
  {"code": "B1061-17", "summary": "Lift Pedal Sensor A Out of Range High", "seenCount": 15, "topModels": ["T66"], "lastSeen": "2026-10-01"},
  {"code": "M3507", "summary": "Hydraulic Fan Open Circuit", "seenCount": 15, "topModels": ["T870 T4", "S740 T4", "T770"], "lastSeen": "2026-10-24"},
  {"code": "H1222", "summary": "Right Primary Out of Range Low", "seenCount": 14, "topModels": ["T770", "T770 T4", "S650 T4"], "lastSeen": "2026-10-29"},
  {"code": "M6803", "summary": "HVAC Relay Error Off", "seenCount": 12, "topModels": ["T870 T4", "T770 T4", "T595 T4"], "lastSeen": "2026-10-15"},
  {"code": "B1070-09", "summary": "Tilt Pedal Failure", "seenCount": 11, "topModels": ["T66", "S64"], "lastSeen": "2026-11-09"},
  {"code": "C1192-00", "summary": "System Voltage Extremely Low", "seenCount": 10, "topModels": ["T66", "T64", "T86"], "lastSeen": "2026-11-05"},
  {"code": "E00063708", "summary": "CAM Signal Fault", "seenCount": 9, "topModels": ["T770 T4", "T770", "S740 T4"], "lastSeen": "2026-11-03"},
  {"code": "E00524619", "summary": "DCU CAN Communication Fault", "seenCount": 9, "topModels": ["T770 T4", "T870 T4", "T770"], "lastSeen": "2026-10-24"},
  {"code": "E00010001", "summary": "Engine Oil Pressure Low", "seenCount": 8, "topModels": ["T76", "T66", "T62 T4"], "lastSeen": "2026-10-18"},
  {"code": "M0310", "summary": "System Voltage Too High", "seenCount": 8, "topModels": ["T595 T4", "S650 T4", "T740"], "lastSeen": "2026-10-05"},
  {"code": "P1125-00", "summary": "Fuel Filter Extremely Plugged", "seenCount": 8, "topModels": ["T66", "T64", "T86"], "lastSeen": "2026-10-05"},
  {"code": "B1071-17", "summary": "Tilt Pedal Sensor A Out of Range High", "seenCount": 7, "topModels": ["T66"], "lastSeen": "2026-10-01"},
  {"code": "C10C0-F0", "summary": "Right Swash Plate Not in Neutral", "seenCount": 7, "topModels": ["T76", "T66", "T62 T4"], "lastSeen": "2026-09-18"},
  {"code": "M0322", "summary": "System Voltage Out Of Range Low", "seenCount": 7, "topModels": ["E26R", "E35", "E60"], "lastSeen": "2026-11-08"},
  {"code": "U00351601", "summary": "DEF Quality Too Low", "seenCount": 7, "topModels": ["T770 T4", "T770"], "lastSeen": "2026-11-11"},
  {"code": "U06145519", "summary": "CAN Communications Fault", "seenCount": 6, "topModels": ["T870 T4", "T770 T4", "T770"], "lastSeen": "2026-10-30"},
  {"code": "C10C5-F0", "summary": "Left Swash Plate Not in Neutral", "seenCount": 5, "topModels": ["T66", "T76", "T62 T4"], "lastSeen": "2026-10-21"},
  {"code": "E00524621", "summary": "SCR Inducement - Blocked EGR", "seenCount": 5, "topModels": ["T770 T4", "T870 T4"], "lastSeen": "2026-09-17"},
  {"code": "M0511", "summary": "Hydraulic Charge Pressure Extremely High", "seenCount": 5, "topModels": ["T650 T4"], "lastSeen": "2026-08-04"},
  {"code": "U00436003", "summary": "SCR Pre-Treatment Temperature Sensor Out of Range High", "seenCount": 5, "topModels": ["T770 T4"], "lastSeen": "2026-11-10"},
  {"code": "U06145419", "summary": "CAN Communications Fault", "seenCount": 5, "topModels": ["T870 T4", "T770 T4", "T770"], "lastSeen": "2026-10-30"},
  {"code": "U06488919", "summary": "CAN Communications Fault", "seenCount": 5, "topModels": ["T770 T4", "T770", "T870 T4"], "lastSeen": "2026-10-29"},
  {"code": "U06492319", "summary": "CAN Communications Fault", "seenCount": 5, "topModels": ["T770 T4", "T770", "T870 T4"], "lastSeen": "2026-10-29"},
  {"code": "B1061-16", "summary": "Lift Pedal Sensor A Out of Range Low", "seenCount": 4, "topModels": ["T66", "T64"], "lastSeen": "2026-10-19"},
  {"code": "B1063-00", "summary": "Lift Pedal Sensor In Error", "seenCount": 4, "topModels": ["T64", "S62", "T66"], "lastSeen": "2026-10-19"},
  {"code": "B1071-16", "summary": "Tilt Pedal Sensor A Out of Range Low", "seenCount": 4, "topModels": ["T66"], "lastSeen": "2026-11-09"},
  {"code": "C1080-F8", "summary": "Hydraulic Charge Pressure Extremely Low", "seenCount": 4, "topModels": ["T66", "S66"], "lastSeen": "2026-10-27"},
  {"code": "C1090-00", "summary": "Hydraulic Filter Plugged", "seenCount": 4, "topModels": ["T86"], "lastSeen": "2026-10-15"},
  {"code": "C1190-00", "summary": "System Voltage Out of Range Low", "seenCount": 4, "topModels": ["T66"], "lastSeen": "2026-09-04"},
  {"code": "P1100-FC", "summary": "Engine Coolant Temperature Limiting Performance", "seenCount": 4, "topModels": ["T86", "T66"], "lastSeen": "2026-11-06"},
  {"code": "B1073-00", "summary": "Tilt Pedal Sensor In Error", "seenCount": 3, "topModels": ["T66", "S64"], "lastSeen": "2026-10-19"},
  {"code": "E00009704", "summary": "Water in Fuel Sensor Fault", "seenCount": 3, "topModels": ["T770", "T770 T4"], "lastSeen": "2026-10-19"},
  {"code": "E00013203", "summary": "MAF Sensor - Fault", "seenCount": 3, "topModels": ["T595 T4", "T650 T4"], "lastSeen": "2026-08-14"},
  {"code": "E52070012", "summary": "ECU Internal Fault", "seenCount": 3, "topModels": ["T66", "T86"], "lastSeen": "2026-10-26"},
  {"code": "H9314", "summary": "Fuel Pressure Extremely Low", "seenCount": 3, "topModels": ["T595 T4", "T450 T4"], "lastSeen": "2026-11-03"},
  {"code": "M2899", "summary": "Throttle Secondary Sensor Calibration Required", "seenCount": 3, "topModels": ["T595 T4", "T770"], "lastSeen": "2026-08-27"},
  {"code": "U00321619", "summary": "NOx Pre-treatment Sensor Fault", "seenCount": 3, "topModels": ["T770 T4"], "lastSeen": "2026-10-29"},
  {"code": "U1201-00", "summary": "Engine Disabled", "seenCount": 3, "topModels": ["T66", "T66-2"], "lastSeen": "2026-11-06"},
  {"code": "B1080-16", "summary": "Seat Bar Sensor Out of Range Low", "seenCount": 2, "topModels": ["T66"], "lastSeen": "2026-10-21"},
  {"code": "M0414", "summary": "Engine Oil Pressure Extremely Low", "seenCount": 2, "topModels": ["E35"], "lastSeen": "2026-08-07"},
  {"code": "M0415", "summary": "Engine Oil Pressure In Shutdown", "seenCount": 2, "topModels": ["E35"], "lastSeen": "2026-08-07"},
  {"code": "M7748", "summary": "Key Switch Multiple", "seenCount": 2, "topModels": ["E48", "E55"], "lastSeen": "2026-10-13"},
  {"code": "M9111", "summary": "Fuel Filter Extremely Plugged", "seenCount": 2, "topModels": ["E60"], "lastSeen": "2026-08-24"},
  {"code": "P1115-FC", "summary": "Air Inlet Temperature Limiting Performance", "seenCount": 2, "topModels": ["T66"], "lastSeen": "2026-10-08"},
  {"code": "U00336305", "summary": "DEF Tank Coolant Valve Open Circuit", "seenCount": 2, "topModels": ["T770 T4"], "lastSeen": "2026-10-21"},
  {"code": "U00433712", "summary": "Dosing Valve Tip Temperature Fault", "seenCount": 2, "topModels": ["T770 T4"], "lastSeen": "2026-11-03"},
  {"code": "U00543512", "summary": "General Pressure Check Fault", "seenCount": 2, "topModels": ["T770 T4"], "lastSeen": "2026-09-16"},
  {"code": "B1080-09", "summary": "Seat Bar Sensor Failure", "seenCount": 1, "topModels": ["T66"], "lastSeen": "2026-09-15"},
  {"code": "B1080-17", "summary": "Seat Bar Sensor Out of Range High", "seenCount": 1, "topModels": ["T66-2"], "lastSeen": "2026-10-08"},
  {"code": "C1041-00", "summary": "Lift Spool Position Sensor Inverted Movement", "seenCount": 1, "topModels": ["T76"], "lastSeen": "2026-09-22"},
  {"code": "C1196-00", "summary": "System Voltage Extremely High", "seenCount": 1, "topModels": ["T62 T4"], "lastSeen": "2026-07-15"},
  {"code": "C1260-FA", "summary": "Service Brake Pressure High", "seenCount": 1, "topModels": ["L85 T4"], "lastSeen": "2026-09-13"},
  {"code": "E00063011", "summary": "Injector Data Fault", "seenCount": 1, "topModels": ["T770"], "lastSeen": "2026-08-12"},
  {"code": "E00063608", "summary": "Crank position sensor fault", "seenCount": 1, "topModels": ["T870 T4"], "lastSeen": "2026-08-25"},
  {"code": "E00063702", "summary": "CAM Signal Fault", "seenCount": 1, "topModels": ["T770"], "lastSeen": "2026-10-07"},
  {"code": "M6203", "summary": "Tailgate Fan 1 Error Off", "seenCount": 1, "topModels": ["T770 T4"], "lastSeen": "2026-08-13"},
  {"code": "M6303", "summary": "Tailgate Fan 2 Error Off", "seenCount": 1, "topModels": ["T770 T4"], "lastSeen": "2026-08-13"},
  {"code": "P1110-FC", "summary": "Fuel Temperature Limiting Performance", "seenCount": 1, "topModels": ["T66-2"], "lastSeen": "2026-10-07"},
  {"code": "U00336104", "summary": "Dosing Valve Short to Ground", "seenCount": 1, "topModels": ["T770"], "lastSeen": "2026-10-01"},
  {"code": "U00353203", "summary": "DEF Level Sensor Fault", "seenCount": 1, "topModels": ["T770 T4"], "lastSeen": "2026-08-12"},
  {"code": "U00434205", "summary": "DEF Outlet Line Heater Short to Ground or Open Circuit", "seenCount": 1, "topModels": ["T770"], "lastSeen": "2026-07-15"},
  {"code": "U00434405", "summary": "DEF Backflow Line Heater Short to Ground or Open Circuit", "seenCount": 1, "topModels": ["T770"], "lastSeen": "2026-07-15"},
  {"code": "U00434605", "summary": "DEF Inlet Line Heater Short to Ground or Open Circuit", "seenCount": 1, "topModels": ["T770"], "lastSeen": "2026-07-15"},
  {"code": "U10438509", "summary": "Nox Post-Treatment Fault", "seenCount": 1, "topModels": ["T770 T4"], "lastSeen": "2026-08-26"}
];

// Starter destinations, from Tanner's "CRM Contact Sheet" (Nov 12, 2026).
// Loaded once from Telematics → Settings ("Load contact sheet"); after that
// they live in telematicsConfig/settings and are edited there.
// Corrections made on the way in (flag them to Erin, don't silently re-add):
//   - sfeldhake@ / rlinhart@ were spelled "bobctofindy.com" on the sheet →
//     bobcatofindy.com, the domain every other Indy address uses.
//   - Indy North service has no To yet ("waiting on new hire"): its CC,
//     Nate Baxter, is sent To until then (resolveRecipients).
//   - Field Service had no one on the sheet: added empty, to be filled in.
// Not changed: Dale Brooks is listed as mbrooks@bobcatofanderson.com.
const p = (name, email) => ({ name, email });
export const TELEMATICS_SEED_DESTINATIONS = [
  { id: 'field-service', kind: 'field', name: 'Field Service', branch: '', to: [], cc: [] },

  { id: 'indy-service', kind: 'service', name: 'Indy South Service', branch: 'Indy',
    to: [p('Bob Barth', 'bbarth@bobcatofindy.com'), p('Wayne Barry', 'Wbarry@bobcatofindy.com')],
    cc: [p('Rob Linhart', 'rlinhart@bobcatofindy.com')] },
  { id: 'indy-parts', kind: 'parts', name: 'Indy South Parts', branch: 'Indy',
    to: [p('Steve Feldhake', 'sfeldhake@bobcatofindy.com'), p('Jeff Hardcastle', 'Jhardcastle@bobcatofindy.com'), p('Adam Walters', 'awalters@bobcatofindy.com')],
    cc: [p('Rob Linhart', 'rlinhart@bobcatofindy.com')] },

  { id: 'anderson-service', kind: 'service', name: 'Anderson Service', branch: 'Anderson',
    to: [p('Brandi Lawyer', 'blawyer@bobcatofanderson.com'), p('Nathan Luck', 'NLuck@bobcatofanderson.com')],
    cc: [p('Jack Binegar', 'jbinegar@bobcatofanderson.com')] },
  { id: 'anderson-parts', kind: 'parts', name: 'Anderson Parts', branch: 'Anderson',
    to: [p('Dale Brooks', 'mbrooks@bobcatofanderson.com'), p('Gary Craig', 'gcraig@bobcatofanderson.com'), p('Alex Hueston', 'AHueston@bobcatofindy.com')],
    cc: [p('Jack Binegar', 'jbinegar@bobcatofanderson.com')] },

  { id: 'indy-north-service', kind: 'service', name: 'Indy North Service', branch: 'Indy North',
    to: [], cc: [p('Nate Baxter', 'nbaxter@bobcatofindy.com')] },
  { id: 'indy-north-parts', kind: 'parts', name: 'Indy North Parts', branch: 'Indy North',
    to: [p('Ricardo Jimenez', 'RJimenez@bobcatofindy.com'), p('Max Thurman', 'MJThurman@bobcatofindy.com')],
    cc: [p('Nate Baxter', 'nbaxter@bobcatofindy.com')] },

  { id: 'ellettsville-service', kind: 'service', name: 'Ellettsville Service', branch: 'Ellettsville',
    to: [p('Kristy Sosbe', 'ksosbe@bobcatofellettsville.com')], cc: [p('Michael Butler', 'MButler@bobcatofellettsville.com')] },
  { id: 'ellettsville-parts', kind: 'parts', name: 'Ellettsville Parts', branch: 'Ellettsville',
    to: [p('Laura Hughes', 'lhughes@bobcatofellettsville.com')], cc: [p('Michael Butler', 'MButler@bobcatofellettsville.com')] },

  { id: 'columbus-service', kind: 'service', name: 'Columbus Service', branch: 'Columbus',
    to: [p('Derek Helton', 'dhelton@bobcatofcolumbus.com')], cc: [p('Chase Neville', 'CNeville@bobcatofcolumbus.com')] },
  { id: 'columbus-parts', kind: 'parts', name: 'Columbus Parts', branch: 'Columbus',
    to: [p('Kellen Hottell', 'khottell@bobcatofindy.com')], cc: [p('Chase Neville', 'CNeville@bobcatofcolumbus.com')] }
];
