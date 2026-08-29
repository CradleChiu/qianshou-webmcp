import json
import os
import sys
from datetime import datetime, timedelta, timezone
from urllib.request import Request, urlopen


OTP_URL = os.environ.get(
    "OTP_GRAPHQL_URL", "http://127.0.0.1:8080/otp/gtfs/v1"
)
TAIPEI_TIMEZONE = timezone(timedelta(hours=8))

PLAN_QUERY = """
query MultimodalSmoke(
  $origin: PlanLabeledLocationInput!
  $destination: PlanLabeledLocationInput!
  $dateTime: PlanDateTimeInput!
  $modes: PlanModesInput!
  $preferences: PlanPreferencesInput!
) {
  planConnection(
    origin: $origin
    destination: $destination
    dateTime: $dateTime
    modes: $modes
    preferences: $preferences
    first: 5
  ) {
    edges {
      node {
        duration
        numberOfTransfers
        legs {
          mode
          route { shortName longName }
          from { name }
          to { name }
        }
      }
    }
  }
}
"""


def post_graphql(query, variables=None):
    payload = json.dumps(
        {"query": query, "variables": variables or {}}, ensure_ascii=False
    ).encode("utf-8")
    request = Request(
        OTP_URL,
        data=payload,
        headers={"content-type": "application/json"},
        method="POST",
    )
    with urlopen(request, timeout=45) as response:
        result = json.load(response)
    if result.get("errors"):
        raise AssertionError(f"OTP GraphQL errors: {result['errors']}")
    return result["data"]


def location(latitude, longitude):
    return {
        "location": {
            "coordinate": {"latitude": latitude, "longitude": longitude}
        }
    }


def main():
    sys.stdout.reconfigure(encoding="utf-8")

    routes = post_graphql("{ routes { mode } }")["routes"]
    bus_count = sum(route["mode"] == "BUS" for route in routes)
    subway_count = sum(route["mode"] == "SUBWAY" for route in routes)
    assert bus_count >= 1000, f"expected double-Taipei bus routes, got {bus_count}"
    assert subway_count >= 7, f"expected TRTC routes, got {subway_count}"

    local_noon = datetime.now(TAIPEI_TIMEZONE).replace(
        hour=12, minute=0, second=0, microsecond=0
    )
    data = post_graphql(
        PLAN_QUERY,
        {
            "origin": location(24.866576, 121.5511543),
            "destination": location(25.167602, 121.445736),
            "dateTime": {"earliestDeparture": local_noon.isoformat()},
            "modes": {
                "direct": ["WALK"],
                "transit": {
                    "transit": [{"mode": "BUS"}, {"mode": "SUBWAY"}]
                },
            },
            "preferences": {"street": {"walk": {"reluctance": 4}}},
        },
    )
    itineraries = [
        edge.get("node")
        for edge in data.get("planConnection", {}).get("edges", [])
        if edge.get("node")
    ]
    assert itineraries, "OTP returned no Wulai-to-Tamsui itinerary"

    multimodal = next(
        (
            itinerary
            for itinerary in itineraries
            if {leg.get("mode") for leg in itinerary.get("legs", [])}
            >= {"BUS", "SUBWAY"}
        ),
        None,
    )
    assert multimodal, "OTP returned no itinerary containing both BUS and SUBWAY"

    summary = []
    for leg in multimodal["legs"]:
        route = leg.get("route") or {}
        route_name = route.get("shortName") or route.get("longName") or leg["mode"]
        summary.append(f"{leg['mode']}:{route_name}")
    print(
        "OTP multimodal smoke passed | "
        f"BUS routes={bus_count} | SUBWAY routes={subway_count} | "
        + " -> ".join(summary)
    )


if __name__ == "__main__":
    main()
