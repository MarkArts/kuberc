import { assertEquals } from "https://deno.land/std@0.192.0/testing/asserts.ts";
import {
  checkDeploymentOrStateFullSet,
  checkHPA,
  checkIngress,
  checkPodMonitor,
  checkService,
} from "./checks.ts";

const service = {
  apiVersion: "v1",
  kind: "Service",
  metadata: {
    name: "testService",
  },
  spec: {
    ports: [
      {
        name: "api",
        port: 42,
      },
    ],
  },
};

const ingress = {
  apiVersion: "v1",
  kind: "Ingress",
  metadata: {
    name: "testIngress",
  },
  spec: {
    rules: [
      {
        host: "testhost",
        http: {
          paths: [
            {
              path: "/",
              backend: {
                service: {
                  name: service.metadata.name,
                  port: {
                    name: "api",
                  },
                },
              },
            },
          ],
        },
      },
    ],
  },
};

const podMonitor = {
  apiVersion: "monitoring.coreos.com/v1",
  kind: "PodMonitor",
  metadata: {
    name: "euc1-testing-example-flower-pod-monitor",
  },
  spec: {
    podMetricsEndpoints: [
      {
        path: "/metrics",
        port: "flower",
      },
    ],
    selector: {
      matchLabels: {
        "app": "example",
      },
    },
  },
};

const deployment = {
  "apiVersion": "apps/v1",
  "kind": "Deployment",
  "metadata": {
    "name": "euc1-testing-example-flower-deployment",
  },
  "spec": {
    "selector": {
      "matchLabels": {
        "app": "example",
      },
    },
    "template": {
      "metadata": {
        "labels": {
          "app": "example",
        },
      },
      "spec": {
        "containers": [
          {
            "env": [],
            "envFrom": [
              {
                "configMapRef": {
                  "name": "euc1-testing-example-env-2d5b8f6ggb",
                },
              },
            ],
            "image": "mher/flower:1.2",
            "name": "flower",
            "ports": [
              {
                "containerPort": 5555,
                "name": "flower",
              },
            ],
          },
        ],
        "volumes": [
          {
            "configMap": {
              "items": [],
              "name": "euc1-testing-example-flower-config",
            },
            "name": "config",
          },
          {
            "name": "flower-storage",
            "persistentVolumeClaim": {
              "claimName": "euc1-testing-example-efs-claim",
            },
          },
        ],
      },
    },
  },
};

Deno.test("Test pod monitor", async (t) => {
  await t.step(
    "check for Podmonitor existing",
    () => {
      assertEquals(
        checkPodMonitor(podMonitor, [podMonitor, deployment]).length,
        0,
      );
    },
  );

  await t.step("Check for no label matching", () => {
    assertEquals(checkPodMonitor(podMonitor, [podMonitor]).length, 1);
  });

  await t.step("Check label matching but port not existing", () => {
    const brokenPodMonitor = { ...podMonitor };
    brokenPodMonitor.spec.podMetricsEndpoints[0].port = "doesnotexist";
    assertEquals(
      checkPodMonitor(podMonitor, [podMonitor, deployment]).length,
      1,
    );
  });
});

Deno.test("Test ingress check", async (t) => {
  await t.step("Check for valid service", () => {
    assertEquals(checkIngress(ingress, [ingress, service]).length, 0);
  });

  await t.step("Check for service not existing", () => {
    assertEquals(checkIngress(ingress, [ingress]).length, 1);
  });

  await t.step(
    "Check for issues when service exist but ingress references 2 ports that don't",
    () => {
      const brokenIngress = { ...ingress };
      ingress.spec.rules[0].http.paths = [
        {
          path: "/",
          backend: {
            service: {
              name: service.metadata.name,
              port: {
                name: "doesnotexist",
              },
            },
          },
        },
        {
          path: "/api",
          backend: {
            service: {
              name: service.metadata.name,
              port: {
                name: "doesalsonotexist",
              },
            },
          },
        },
      ];
      assertEquals(
        checkIngress(brokenIngress, [brokenIngress, service]).length,
        2,
      );
    },
  );
});
