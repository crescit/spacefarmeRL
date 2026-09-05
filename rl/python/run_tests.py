import sys, os, unittest
root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, root)
loader = unittest.TestLoader()
suite = unittest.TestSuite()
mods = ["rl.python.tests.test_env_gym", "rl.python.tests.test_rollouts",
        "rl.python.tests.test_eval_alignment", "rl.python.tests.test_llm_policy",
        "rl.python.tests.test_validity_gate", "rl.python.tests.test_narrative_stats",
        "rl.python.tests.test_transcript", "rl.python.tests.test_rollout_tools",
        "rl.python.tests.test_render_eval_report", "rl.python.tests.test_tool_dialog",
        "rl.python.tests.test_compare_evals"]
for mod in mods:
    try:
        m = __import__(mod, fromlist=["*"])
        suite.addTests(loader.loadTestsFromModule(m))
    except Exception as e:
        print(f"IMPORT-FAIL {mod}: {type(e).__name__}: {e}")
res = unittest.TextTestRunner(verbosity=1).run(suite)
print("RESULT:", "PASS" if res.wasSuccessful() else "FAIL",
      f"({res.testsRun} tests, {len(res.failures)} failures, {len(res.errors)} errors)")
sys.exit(0 if res.wasSuccessful() else 1)
