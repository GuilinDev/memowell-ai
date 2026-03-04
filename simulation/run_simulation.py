"""
CareLoop Agent Simulation — Virtual Nursing Home
================================================

Runs a simulated 8-hour shift in a memory care facility with:
- 25 AI patients with diverse dementia profiles
- 8 AI caregivers with varying skill levels
- Real CareLoop API calls for event reporting and protocol retrieval
- Automated evaluation of coverage and response quality

Inspired by:
- Generative Agents (Stanford, UIST 2023)
- ACE: Agentic Context Engineering (Stanford, 2025)
- ScalingEval: No-Human-in-the-Loop (NeurIPS 2025 Workshop)

Usage:
    python -m simulation.run_simulation [--api-url URL] [--shift day|evening|night] [--speed MULTIPLIER]
"""
import asyncio
import json
import argparse
import sys
from pathlib import Path
from datetime import datetime

MAX_RETRIES = 3
RETRY_BACKOFF = [3.0, 6.0, 12.0]

# Add project root to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from simulation.engine.clock import SimulationClock
from simulation.engine.environment import Environment, Location, ResidentState
from simulation.agents.patient_agent import PatientAgent
from simulation.agents.caregiver_agent import CaregiverAgent
from simulation.agents.evaluator_agent import EvaluatorAgent


# Shift definitions
SHIFTS = {
    "day": {"start_hour": 7, "end_hour": 15, "duration_hours": 8},
    "evening": {"start_hour": 15, "end_hour": 23, "duration_hours": 8},
    "night": {"start_hour": 23, "end_hour": 7, "duration_hours": 8},
}


def load_profiles():
    """Load patient and caregiver profiles from JSON files."""
    base = Path(__file__).parent / "profiles"

    with open(base / "patients" / "residents.json") as f:
        patients_data = json.load(f)

    with open(base / "caregivers" / "staff.json") as f:
        staff_data = json.load(f)

    return patients_data["residents"], staff_data["staff"]


def setup_agents(patients, staff, shift: str, api_url: str):
    """Create agent instances for the given shift."""
    # Create patient agents for all residents
    patient_agents = [PatientAgent(p) for p in patients]

    # Filter caregivers to the active shift
    shift_staff = [s for s in staff if s["shift"] == shift]
    caregiver_agents = [CaregiverAgent(s, api_base_url=api_url) for s in shift_staff]

    return patient_agents, caregiver_agents


async def ensure_staff_exist(api_url: str, staff: list, facility_id: int = 1):
    """Ensure all staff exist in the CareLoop database via direct DB seeding."""
    import httpx
    # CareLoop doesn't have a staff creation API endpoint yet,
    # so we seed staff via a special simulation endpoint or direct DB.
    # For now, create them via a lightweight POST if available, otherwise
    # we'll use the reporter_id=1 fallback (the demo seed staff).
    staff_id_map = {}
    async with httpx.AsyncClient(base_url=api_url, timeout=30.0) as client:
        # Try to check if staff exist via a health-like endpoint
        # For V1: just map all caregivers to reporter_id=1 (the seed staff)
        # This is a known limitation — staff CRUD API needed for V2
        for i, s in enumerate(staff):
            staff_id_map[s["id"]] = 1  # All map to default staff id=1
            print(f"  📋 Staff mapped: {s['name']} → reporter_id=1 (shared)")
    return staff_id_map


async def ensure_patients_exist(api_url: str, patients: list, facility_id: int = 1):
    """Ensure all patients exist in the CareLoop database."""
    import httpx
    async with httpx.AsyncClient(base_url=api_url, timeout=30.0) as client:
        # Get existing patients
        existing_map = {}  # name -> id
        try:
            resp = await client.get("/api/patients")
            if resp.status_code == 200:
                for p in resp.json():
                    existing_map[p["name"]] = p["id"]
        except Exception:
            pass

        # Create missing patients
        patient_id_map = {}
        for p in patients:
            if p["name"] in existing_map:
                patient_id_map[p["id"]] = existing_map[p["name"]]
                print(f"  ⏭️  Patient exists: {p['name']} (id={existing_map[p['name']]})")
            else:
                created = False
                for attempt in range(MAX_RETRIES):
                    try:
                        resp = await client.post("/api/patients", json={
                            "facility_id": facility_id,
                            "name": p["name"],
                            "room": f"Room {p['id'][1:]}",
                            "diagnosis": p.get("diagnosis", "Dementia"),
                            "cognitive_level": p.get("stage", "moderate"),
                            "medications": p.get("medications", []),
                            "allergies": [],
                            "special_notes": f"{p.get('personality', '')} Behaviors: {', '.join(p.get('common_behaviors', []))}.",
                        })
                        if resp.status_code in (200, 201):
                            data = resp.json()
                            patient_id_map[p["id"]] = data.get("id", 1)
                            print(f"  ✅ Created patient: {p['name']} (id={patient_id_map[p['id']]})")
                            created = True
                            break
                        elif resp.status_code >= 500 or resp.status_code == 429:
                            wait = RETRY_BACKOFF[attempt] if attempt < len(RETRY_BACKOFF) else RETRY_BACKOFF[-1]
                            print(f"  ⚠️ {resp.status_code} creating {p['name']}, retry {attempt+1}/{MAX_RETRIES}...")
                            await asyncio.sleep(wait)
                        else:
                            print(f"  ❌ Failed to create {p['name']}: {resp.status_code} {resp.text[:200]}")
                            break
                    except (httpx.TimeoutException, httpx.ConnectError) as e:
                        wait = RETRY_BACKOFF[attempt] if attempt < len(RETRY_BACKOFF) else RETRY_BACKOFF[-1]
                        print(f"  ⚠️ {type(e).__name__} creating {p['name']}, retry {attempt+1}/{MAX_RETRIES}...")
                        await asyncio.sleep(wait)
                    except Exception as e:
                        print(f"  ❌ Failed to create {p['name']}: {e}")
                        break
                if not created and p["id"] not in patient_id_map:
                    print(f"  ❌ All retries exhausted for {p['name']}")

        # If we couldn't get IDs, use sequential
        if not patient_id_map:
            for i, p in enumerate(patients):
                patient_id_map[p["id"]] = i + 1

        return patient_id_map


async def run_shift(
    shift: str = "day",
    api_url: str = "http://localhost:8000",
    time_step_minutes: int = 30,
    verbose: bool = True,
):
    """
    Run a complete shift simulation.
    """
    print("\n" + "=" * 70)
    print("🏥 CARELOOP VIRTUAL NURSING HOME — AGENT SIMULATION")
    print("=" * 70)

    # Load profiles
    patients_data, staff_data = load_profiles()
    print(f"\n📋 Loaded {len(patients_data)} patient profiles, {len(staff_data)} staff profiles")

    # Setup
    shift_config = SHIFTS[shift]
    clock = SimulationClock(
        start_time=datetime(2026, 3, 3, shift_config["start_hour"], 0, 0),
    )
    env = Environment()
    evaluator = EvaluatorAgent()

    # Create agents
    patient_agents, caregiver_agents = setup_agents(patients_data, staff_data, shift, api_url)
    print(f"🤖 Active agents: {len(patient_agents)} patients, {len(caregiver_agents)} caregivers")
    print(f"⏰ Shift: {shift} ({shift_config['start_hour']}:00 - {shift_config['end_hour']}:00)")

    # Ensure patients and staff exist in CareLoop DB
    print(f"\n📥 Ensuring patients exist in CareLoop ({api_url})...")
    patient_id_map = await ensure_patients_exist(api_url, patients_data)
    print(f"\n👥 Setting up staff mapping...")
    staff_id_map = await ensure_staff_exist(api_url, staff_data)

    # Initialize environment
    for p in patients_data:
        env.add_resident(p["id"], p["name"])
    for s in staff_data:
        if s["shift"] == shift:
            env.add_staff(s["id"], s["name"])
            env.update_staff(s["id"], on_duty=True)

    # Main simulation loop
    print(f"\n{'=' * 70}")
    print(f"▶️  SIMULATION START — {clock.format_datetime()}")
    print(f"{'=' * 70}\n")

    total_events = 0
    steps = shift_config["duration_hours"] * 60 // time_step_minutes

    for step in range(steps):
        clock.advance(time_step_minutes)

        if verbose:
            print(f"\n--- ⏰ {clock.format_time()} ({clock.time_of_day}) ---")

        # Each patient agent decides whether to trigger a behavior
        for pa in patient_agents:
            event = pa.should_trigger_behavior(clock, env)
            if event is None:
                continue

            # Throttle API calls to avoid upstream rate limits (Groq etc.)
            if total_events > 0:
                await asyncio.sleep(3)  # 3s between events

            total_events += 1
            behavior = event["behavior"]
            patient_name = event["patient_name"]

            if verbose:
                print(f"\n  🔴 EVENT #{total_events}: {patient_name} — {behavior.replace('_', ' ')}")
                print(f"     {event.get('context', '')[:100]}...")

            # Find an available caregiver (prefer assigned, then any available)
            caregiver = _find_caregiver(caregiver_agents, pa.id)
            if not caregiver:
                if verbose:
                    print(f"     ⚠️ No caregiver available! Event unattended.")
                evaluator.issues.append(f"Unattended event: {patient_name} - {behavior}")
                continue

            # Caregiver reports to CareLoop
            api_patient_id = patient_id_map.get(pa.id, 1)
            reporter_id = staff_id_map.get(caregiver.id, 1)
            api_response = await caregiver.report_event(
                event, patient_api_id=api_patient_id, reporter_api_id=reporter_id
            )

            if verbose and api_response:
                protocols = api_response.get("protocols", [])
                if protocols:
                    print(f"     📋 CareLoop returned {len(protocols)} protocol(s)")
                    for p in protocols[:2]:
                        steps_list = p.get("steps", [])
                        if steps_list:
                            print(f"        → {steps_list[0][:80]}...")
                elif api_response.get("positive_report"):
                    print(f"     ✅ CareLoop: positive report, no action needed")

            # Evaluate CareLoop's response
            eval_result = evaluator.evaluate_event_response(event, api_response)
            if verbose:
                print(f"     📊 Score: {eval_result['score']}/100 {'✅' if eval_result['pass'] else '❌'}")

            # Caregiver performs intervention
            if api_response and api_response.get("protocols"):
                protocol_steps = []
                for p in api_response["protocols"]:
                    steps = p.get("steps") or []
                    protocol_steps.extend(steps)

                intervention = caregiver.choose_intervention(event, protocol_steps)
                event_id = api_response.get("event_id")

                if event_id:
                    int_result = await caregiver.report_intervention(event_id, intervention)

                    # Determine outcome
                    outcome_desc, resolved, outcome_cat = caregiver.determine_outcome(event, intervention)
                    out_result = await caregiver.report_outcome(event_id, outcome_desc, resolved)

                    if verbose and int_result:
                        print(f"     💊 Intervention: {intervention[:80]}...")

                    # Feed back to patient agent
                    pa.receive_intervention_result(behavior, intervention, outcome_cat)

                    if verbose:
                        emoji = {"resolved": "✅", "partially_resolved": "🟡",
                                 "ineffective": "🔴", "escalated": "🚨"}.get(outcome_cat, "❓")
                        print(f"     {emoji} Outcome: {outcome_cat}")

        # Check callbacks
        await clock.check_callbacks()

    # End of shift
    print(f"\n{'=' * 70}")
    print(f"⏹️  SIMULATION END — {clock.format_datetime()}")
    print(f"{'=' * 70}")

    # Generate handoff reports
    print(f"\n📝 Generating shift handoff reports...")
    for cg in caregiver_agents:
        handoff = await cg.generate_handoff()
        if handoff:
            print(f"  ✅ {cg.name}: handoff generated")
        summary = cg.get_shift_summary()
        print(f"  📊 {cg.name}: {summary['events_reported']} events, "
              f"{summary['interventions_performed']} interventions")

    # Print evaluation report
    print(evaluator.get_full_report()["summary"])

    # Cleanup
    for cg in caregiver_agents:
        await cg.close()

    return evaluator.get_full_report()


def _find_caregiver(caregivers: list, patient_id: str):
    """Find best available caregiver for a patient."""
    # Prefer assigned caregiver
    for cg in caregivers:
        if patient_id in cg.assigned_patients:
            return cg
    # Fall back to any caregiver
    return caregivers[0] if caregivers else None


def main():
    parser = argparse.ArgumentParser(description="CareLoop Virtual Nursing Home Simulation")
    parser.add_argument("--api-url", default="http://localhost:8000",
                        help="CareLoop API base URL")
    parser.add_argument("--shift", choices=["day", "evening", "night"], default="day",
                        help="Which shift to simulate")
    parser.add_argument("--time-step", type=int, default=30,
                        help="Time step in virtual minutes (default: 30)")
    parser.add_argument("--quiet", action="store_true",
                        help="Reduce output verbosity")
    parser.add_argument("--railway", action="store_true",
                        help="Use Railway deployment URL")
    args = parser.parse_args()

    api_url = args.api_url
    if args.railway:
        api_url = "https://memowell-ai-production.up.railway.app"

    report = asyncio.run(run_shift(
        shift=args.shift,
        api_url=api_url,
        time_step_minutes=args.time_step,
        verbose=not args.quiet,
    ))

    # Save report
    output_path = Path(__file__).parent / "evaluation" / "latest_report.json"
    output_path.parent.mkdir(exist_ok=True)
    with open(output_path, "w") as f:
        json.dump(report, f, indent=2)
    print(f"\n💾 Report saved to {output_path}")


if __name__ == "__main__":
    main()
