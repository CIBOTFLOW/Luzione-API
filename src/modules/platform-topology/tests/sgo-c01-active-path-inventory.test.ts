import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  SgoC01InventoryValidationError,
  validateSgoC01ActivePathInventory,
} from "../sgoC01ActivePathInventory";

type MutableInventory = Record<string, unknown> & {
  active_surfaces: Array<Record<string, unknown>>;
  evidence_pins: Array<Record<string, unknown>>;
  source_repositories: Array<Record<string, unknown>>;
  strongest_claim: Record<string, unknown>;
  uncredited_paths: Array<Record<string, unknown>>;
};

const inventoryPath = "engineering/execution/SGO_C01_ACTIVE_SULTAN_PATH_INVENTORY_V1.json";

function fixture(): MutableInventory {
  return JSON.parse(readFileSync(inventoryPath, "utf8")) as MutableInventory;
}

function activeSurface(inventory: MutableInventory, surfaceId: string) {
  const surface = inventory.active_surfaces.find((item) => item.surface_id === surfaceId);
  assert.ok(surface, `missing fixture surface ${surfaceId}`);
  return surface;
}

function uncreditedPath(inventory: MutableInventory, pathId: string) {
  const path = inventory.uncredited_paths.find((item) => item.path_id === pathId);
  assert.ok(path, `missing fixture path ${pathId}`);
  return path;
}

function rejectsWith(code: string, mutate: (inventory: MutableInventory) => void) {
  const inventory = fixture();
  mutate(inventory);
  assert.throws(
    () => validateSgoC01ActivePathInventory(inventory),
    (error) => error instanceof SgoC01InventoryValidationError && error.code === code,
  );
}

test("validates the exact C01 producer, owner, command and uncertainty inventory", () => {
  assert.deepEqual(validateSgoC01ActivePathInventory(fixture()), {
    commandCount: 9,
    evidencePinCount: 44,
    surfaceCount: 15,
    uncreditedPathCount: 4,
  });
});

test("rejects work outside the exact build-program and task admission", () => {
  rejectsWith("SGO_C01_EXECUTION_FILTER_MISMATCH", (inventory) => {
    inventory.task_id = "A02";
  });
});

test("rejects a source path or blob that no longer matches the reconciled pin", () => {
  rejectsWith("SGO_C01_EVIDENCE_PIN_MISMATCH", (inventory) => {
    const pin = inventory.evidence_pins.find((item) => item.pin_id === "os-agent-case-runtime");
    assert.ok(pin);
    pin.blob_sha = "0".repeat(40);
  });
});

test("rejects omitted visible surface coverage", () => {
  rejectsWith("SGO_C01_COVERAGE_MISMATCH", (inventory) => {
    inventory.active_surfaces = inventory.active_surfaces.filter(
      (item) => item.surface_id !== "task_assist.task_detail",
    );
  });
});

test("rejects a drawer command credited to more than one action mapping", () => {
  rejectsWith("SGO_C01_COMMAND_PRODUCER_AMBIGUOUS", (inventory) => {
    activeSurface(inventory, "command.create_task").action_types = ["create_task", "decision_draft"];
  });
});

test("rejects names-only capability evidence without the complete reachable chain", () => {
  rejectsWith("SGO_C01_NAME_ONLY_CLAIM", (inventory) => {
    const surface = activeSurface(inventory, "simulation.agent_case_lab");
    surface.evidence_chain = [
      {
        ordinal: 1,
        role: "RUNTIME_INVOCATION",
        pin_id: "os-agent-case-runtime",
        observation: "A runtime file with an Agent Case name exists in Sultan OS.",
      },
    ];
  });
});

test("rejects multiple canonical source owners for one active surface", () => {
  rejectsWith("SGO_C01_INVALID_RECORD", (inventory) => {
    const surface = activeSurface(inventory, "chat.main_drawer");
    surface.canonical_source_owner = [surface.canonical_source_owner, surface.runtime_producer];
  });
});

test("rejects promotion of shadow Runtime v2 into the visible simulation path", () => {
  rejectsWith("SGO_C01_SHADOW_PROMOTED", (inventory) => {
    activeSurface(inventory, "simulation.agent_case_lab").runtime_producer = {
      repository: "CIBOTFLOW/Sultan-OS",
      component: "Runtime v2",
      entry_symbol: "runSultanAgentRuntimeV2",
      evidence_pin_id: "os-runtime-v2",
    };
  });
});

test("rejects substitution of another legitimate producer name and pin", () => {
  rejectsWith("SGO_C01_ACTIVE_BINDING_MISMATCH", (inventory) => {
    activeSurface(inventory, "simulation.agent_case_lab").runtime_producer = {
      repository: "CIBOTFLOW/Sultan-OS",
      component: "developmental doctrine chat",
      entry_symbol: "runDoctrineChat",
      evidence_pin_id: "os-doctrine-chat",
    };
  });
});

test("rejects credit awarded to an ambiguous, shadow or unavailable path", () => {
  rejectsWith("SGO_C01_UNCREDITED_PROMOTED", (inventory) => {
    uncreditedPath(inventory, "ambiguous.sultan_memory_label").capability_credited = true;
  });
});

test("rejects route/runtime activation or authority expansion", () => {
  rejectsWith("SGO_C01_AUTHORITY_EXPANSION", (inventory) => {
    inventory.route_activation = true;
  });
});

test("rejects an owner whose evidence belongs to another repository", () => {
  rejectsWith("SGO_C01_OWNER_PIN_MISMATCH", (inventory) => {
    const owner = activeSurface(inventory, "task_assist.task_detail").canonical_source_owner;
    assert.ok(owner && typeof owner === "object" && !Array.isArray(owner));
    (owner as Record<string, unknown>).evidence_pin_id = "os-private-memory";
  });
});

test("rejects stronger-than-local finality", () => {
  rejectsWith("SGO_C01_FALSE_FINALITY", (inventory) => {
    inventory.strongest_claim.release_evidence = "PRODUCTION_OBSERVED";
  });
});
