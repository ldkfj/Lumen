"""Exact-runner smoke checks; run separately from the pure stub suite."""

import json


COMMIT = "a" * 40
RESULT_ID = "6.0-0001"
CLAIM = "System X delivered 123 Samples/s in the Offline scenario."


def _row_bytes():
    return json.dumps({
        "ID": RESULT_ID, "Submitter": "Vendor X", "Availability": "available",
        "Category": "datacenter", "Suite": "closed", "System": "System X",
        "Platform": "Platform X", "UsedModel": "resnet50", "Model": "ResNet50",
        "Scenario": "Offline", "Accuracy": "99%", "Nodes": 1, "Processor": "CPU X",
        "host_processors_per_node": 2, "host_processor_core_count": 64,
        "Accelerator": "GPU X", "a#": 8, "Total Accelerators": 8,
        "Software": "Stack X", "operating_system": "Linux", "Performance_Result": 123,
        "Performance_Units": "Samples/s", "has_power": False, "Inferred": False,
        "Compliance": ["TEST01"], "Errors": {}, "version": "v6.0",
    }, separators=(",", ":")).encode()


def test_direct_deploy_and_empty_views(direct_deploy):
    contract = direct_deploy("contracts/lumen.py")
    claims = json.loads(contract.get_claims(0, 10))
    assert claims["items"] == []
    assert claims["total"] == "0"


def test_registration_closures_pickle_and_validator_rederives_evidence(direct_vm, direct_deploy):
    body = _row_bytes()
    direct_vm.check_pickling = True
    direct_vm.mock_web(r"vendor\.example/benchmark", {"method": "GET", "status": 200, "body": CLAIM})
    direct_vm.mock_web(r"api\.github\.com/.*/compare/", {
        "method": "GET", "status": 200,
        "body": json.dumps({"status": "ahead", "merge_base_commit": {"sha": COMMIT}}),
    })
    direct_vm.mock_web(r"api\.github\.com/.*/contents/summary_results\.json", {
        "method": "GET",
        "response": {"status": 206, "headers": {"content-range": f"bytes 0-{len(body) - 1}/{len(body)}".encode()}, "body": body},
    })
    contract = direct_deploy("contracts/lumen.py")
    claim_id = contract.register_claim(
        "https://vendor.example/benchmark", CLAIM, RESULT_ID, COMMIT, 0, len(body) - 1, 0,
    )
    assert claim_id == 1
    assert direct_vm.run_validator() is True
    assert direct_vm.run_validator(leader_result={}) is False
    direct_vm.clear_validators()
    # gltest 0.30.0rc2 parses one layer before the v0.3 SDK JSON decoder.
    direct_vm.mock_llm(r".*", json.dumps(json.dumps({
        "contradictions": [], "material_omissions": [],
        "incompatible_scopes": [], "uncertainties": [],
    })))
    assessment_id = contract.assess_claim(claim_id)
    assessment = json.loads(contract.get_assessment(assessment_id))
    assert assessment["outcome"] == "SUPPORTED", (assessment["uncertainty_mask"], assessment["official_row_fingerprint"])
    assert direct_vm.run_validator() is True
    assert direct_vm.run_validator(leader_result={}) is False
