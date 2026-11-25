"""Admission regressions from Comet 154 native open/closed sidecar structure."""
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


@unittest.skipUnless(sys.platform == 'darwin' and shutil.which('xcrun'), 'macOS Swift helper')
class CometClosedSidecarTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        root = Path(cls.temp.name)
        product = Path(__file__).parents[1] / 'app/tracker/chatgpt_session_ax.swift'
        library = product.read_text().split('// Browser-owned scripting metadata admits', 1)[0]
        source = root / 'sidecar.swift'
        source.write_text(library + '''
let request = try! JSONSerialization.jsonObject(with: FileHandle.standardInput.readDataToEndOfFile()) as! [String: Any]
if let addresses = request["addresses"] as? [String] {
    print(String(decoding: try! JSONSerialization.data(withJSONObject: addresses.map { cometBuiltInSidecarURL($0) }), as: UTF8.self))
    exit(0)
}
if let addresses = request["interfaceAddresses"] as? [String] {
    print(String(decoding: try! JSONSerialization.data(withJSONObject: addresses.map { chromiumInterfacePageURL($0) }), as: UTF8.self))
    exit(0)
}
let nodes = request["nodes"] as! [String: [String: Any]]
func rect(_ value: Any?) -> CGRect? {
    guard let v = value as? [Double], v.count == 4 else { return nil }
    return CGRect(x: v[0], y: v[1], width: v[2], height: v[3])
}
let hits = request["hits"] as! [String]
var index = 0
let proof = cometClosedSidecarProof(area: "page", sidecar: "sidecar", windowBounds: rect(request["window"])!,
    parent: { nodes[$0]?["parent"] as? String }, role: { nodes[$0]?["role"] as? String ?? "" },
    classes: { nodes[$0]?["classes"] as? [String] }, children: { nodes[$0]?["children"] as? [String] },
    bounds: { rect(nodes[$0]?["bounds"]) }, same: { $0 == $1 }, hitArea: { _ in
        defer { index += 1 }; return index < hits.count && !hits[index].isEmpty ? hits[index] : nil
    })
print(proof != nil ? "true" : "false")
''')
        cls.helper = root / 'sidecar'
        subprocess.run(['xcrun', 'swiftc', '-O', str(source), '-o', str(cls.helper)],
                       check=True, capture_output=True, timeout=120)

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def fixture(self):
        # Observed native geometry and hierarchy, excluding page/input text.
        return {'window': [22, 52, 980, 642], 'hits': ['page'] * 9, 'nodes': {
            'chrome': {'role': 'AXGroup', 'classes': ['PerplexityBrowserView'],
                       'children': ['contents', 'retained']},
            'contents': {'role': 'AXGroup', 'classes': ['MultiContentsView'], 'parent': 'chrome',
                         'children': ['container'], 'bounds': [27, 178, 970, 511]},
            'container': {'role': 'AXGroup', 'classes': ['ContentsContainerView'], 'parent': 'contents'},
            'scroll': {'role': 'AXScrollArea', 'parent': 'container'},
            'page': {'role': 'AXWebArea', 'parent': 'scroll', 'bounds': [27, 178, 970, 511]},
            'retained': {'role': 'AXScrollArea', 'parent': 'chrome'},
            'sidecar': {'role': 'AXWebArea', 'parent': 'retained', 'bounds': [547, 178, 450, 511]},
        }}

    def admitted(self, fixture):
        output = subprocess.run([str(self.helper)], input=json.dumps(fixture), capture_output=True,
                                text=True, check=True, timeout=10).stdout
        return json.loads(output)

    def observed_top_inset_fixture(self):
        # Comet 154 after closing its assistant: native chrome keeps one point
        # above the page, while the retained assistant remains fully covered.
        f = self.fixture()
        f['window'] = [22, 52, 1200, 664]
        f['nodes']['contents']['bounds'] = [27, 136, 1190, 575]
        f['nodes']['page']['bounds'] = [27, 137, 1190, 574]
        f['nodes']['sidecar']['bounds'] = [767, 137, 450, 574]
        return f

    def observed_separator_fixture(self):
        # Public native metadata after Comet 154's assistant closes, including
        # the one-point strip and the remaining native chrome siblings.
        f = self.observed_top_inset_fixture()
        f['nodes']['separator'] = {'role': 'AXGroup', 'classes': ['ContentsSeparator'],
                                   'parent': 'contents', 'bounds': [27, 136, 1190, 1]}
        f['nodes']['contents']['children'].append('separator')
        chrome = [('top', 'TopContainerView', [27, 96, 1190, 40]),
                  ('tabs', 'HorizontalTabStripRegionViewOld', [96, 52, 1126, 43]),
                  ('view', 'View', [22, 52, 0, 0]),
                  ('bottomLeft', 'PerplexityRoundedCorner', [26, 695, 17, 17]),
                  ('bottomRight', 'PerplexityRoundedCorner', [1201, 695, 17, 17]),
                  ('topLeft', 'PerplexityRoundedCorner', [26, 95, 17, 17]),
                  ('topRight', 'PerplexityRoundedCorner', [1201, 95, 17, 17])]
        for name, native_class, bounds in chrome:
            f['nodes'][name] = {'role': 'AXGroup', 'classes': [native_class],
                                 'parent': 'chrome', 'bounds': bounds}
        f['nodes']['chrome']['children'] = ['top', 'contents', 'tabs', 'view', 'retained',
                                           'bottomLeft', 'bottomRight', 'topLeft', 'topRight']
        return f

    def test_only_observed_builtin_sidecar_urls_are_recognized(self):
        addresses = ['https://www.perplexity.ai/sidecar?copilot=true',
                     'https://www.perplexity.ai/sidecar/?copilot=true',
                     'https://www.perplexity.ai/sidecar',
                     'http://www.perplexity.ai/sidecar?copilot=true',
                     'https://www.perplexity.ai:444/sidecar?copilot=true',
                     'https://www.perplexity.ai.evil.example/sidecar?copilot=true',
                     'https://www.perplexity.ai/sidecar?copilot=false',
                     'https://www.perplexity.ai/sidecar?copilot=true&extra=1',
                     'https://www.perplexity.ai/sidecar?copilot=true#other', '']
        output = subprocess.run([str(self.helper)], input=json.dumps({'addresses': addresses}),
                                capture_output=True, text=True, check=True, timeout=10).stdout
        self.assertEqual(json.loads(output), [True] * 3 + [False] * 7)

    def test_only_chromium_top_chrome_pages_are_interface_pages(self):
        # Chrome's address bar suggestions and side panels (measured Chrome 158).
        addresses = ['chrome://omnibox-popup.top-chrome/',
                     'chrome://read-later.top-chrome/',
                     'chrome-untrusted://read-anything-side-panel.top-chrome/',
                     'https://docs.example.test/',
                     'https://evil.top-chrome/',
                     'chrome://settings/',
                     'chrome://top-chrome/',
                     'chrome-extension://mpognobbkildjkofajifpdfhcoklimli/window.html', '']
        output = subprocess.run([str(self.helper)], input=json.dumps({'interfaceAddresses': addresses}),
                                capture_output=True, text=True, check=True, timeout=10).stdout
        self.assertEqual(json.loads(output), [True] * 3 + [False] * 6)

    def test_closed_retained_area_is_covered_by_current_native_page(self):
        self.assertTrue(self.admitted(self.fixture()))

    def test_observed_one_point_top_inset_admits_covered_closed_sidecar(self):
        self.assertTrue(self.admitted(self.observed_top_inset_fixture()))

    def test_observed_closed_separator_matches_complete_native_metadata(self):
        self.assertTrue(self.admitted(self.observed_separator_fixture()))

    def test_only_exact_one_point_top_separator_is_admitted(self):
        for field, value in [('role', 'AXScrollArea'), ('classes', ['View']),
                             ('classes', ['ContentsSeparator', 'View']),
                             ('parent', 'anotherContents'),
                             ('bounds', [27, 136.5, 1190, 0.5]),
                             ('bounds', [27, 135, 1190, 2]),
                             ('bounds', [28, 136, 1189, 1]),
                             ('bounds', [27, 136, 1191, 1]),
                             ('bounds', [27, 137, 1190, 1])]:
            with self.subTest(field=field, value=value):
                f = self.observed_separator_fixture()
                f['nodes']['separator'][field] = value
                self.assertFalse(self.admitted(f))
        f = self.observed_separator_fixture()
        f['nodes']['contents']['bounds'] = f['nodes']['page']['bounds']
        self.assertFalse(self.admitted(f))
        f = self.observed_separator_fixture()
        f['nodes']['extra'] = dict(f['nodes']['separator'])
        f['nodes']['contents']['children'].append('extra')
        self.assertFalse(self.admitted(f))

    def test_separator_keeps_open_panel_and_all_hit_guards(self):
        f = self.observed_separator_fixture()
        f['nodes']['panel'] = {'role': 'AXGroup', 'classes': ['PerplexitySidecarViewImpl'],
                               'parent': 'chrome'}
        f['nodes']['chrome']['children'].append('panel')
        self.assertFalse(self.admitted(f))
        for index in range(9):
            for hit in ('sidecar', 'otherPage', ''):
                with self.subTest(index=index, hit=hit):
                    f = self.observed_separator_fixture()
                    f['hits'][index] = hit
                    self.assertFalse(self.admitted(f))

    def test_nearby_insets_do_not_admit_other_chrome_geometry(self):
        for bounds in ([27, 136.5, 1190, 574.5], [27, 135, 1190, 576],
                       [26, 136, 1191, 575], [28, 136, 1189, 575],
                       [27, 136, 1191, 575], [27, 136, 1190, 576],
                       [27, 137, 1190, 575]):
            with self.subTest(contents=bounds):
                f = self.observed_top_inset_fixture()
                f['nodes']['contents']['bounds'] = bounds
                self.assertFalse(self.admitted(f))

    def test_one_point_inset_keeps_open_panel_structure_and_hit_guards(self):
        f = self.observed_top_inset_fixture()
        f['nodes']['panel'] = {'role': 'AXGroup', 'classes': ['PerplexitySidecarViewImpl'],
                               'parent': 'chrome'}
        f['nodes']['chrome']['children'].append('panel')
        self.assertFalse(self.admitted(f))

        f = self.observed_top_inset_fixture()
        f['nodes']['contents']['children'].append('another')
        self.assertFalse(self.admitted(f))

        f = self.observed_top_inset_fixture()
        f['nodes']['unknown'] = {'role': 'AXGroup'}
        f['nodes']['chrome']['children'].append('unknown')
        self.assertFalse(self.admitted(f))

        for index in range(9):
            with self.subTest(hit=index):
                f = self.observed_top_inset_fixture()
                f['hits'][index] = 'sidecar'
                self.assertFalse(self.admitted(f))

    def test_open_panel_container_rejects_even_if_hits_or_geometry_are_stale(self):
        f = self.fixture()
        f['nodes']['panel'] = {'role': 'AXGroup', 'classes': ['PerplexitySidecarViewImpl'], 'parent': 'chrome'}
        f['nodes']['chrome']['children'].append('panel')
        self.assertFalse(self.admitted(f))
        f['nodes']['retained']['parent'] = 'panel'
        self.assertFalse(self.admitted(f))

    def test_split_or_unrelated_chrome_hierarchy_rejects(self):
        for node, field, value in [('contents', 'children', ['container', 'another']),
                                  ('retained', 'parent', 'anotherChrome'),
                                  ('container', 'classes', ['View']),
                                  ('chrome', 'children', ['contents'])]:
            with self.subTest(node=node, field=field):
                f = self.fixture(); f['nodes'][node][field] = value
                self.assertFalse(self.admitted(f))

    def test_every_hit_must_belong_to_the_current_page(self):
        for index in range(9):
            for hit in ('sidecar', 'otherPage', ''):
                with self.subTest(index=index, hit=hit):
                    f = self.fixture(); f['hits'][index] = hit
                    self.assertFalse(self.admitted(f))

    def test_unavailable_shape_or_class_cannot_prove_a_closed_panel(self):
        for node, field in [('page', 'bounds'), ('sidecar', 'bounds'), ('contents', 'children'),
                            ('chrome', 'classes'), ('container', 'parent')]:
            with self.subTest(node=node, field=field):
                f = self.fixture(); del f['nodes'][node][field]
                self.assertFalse(self.admitted(f))
        for child in ({'role': 'AXGroup'}, {'role': ''}):
            f = self.fixture(); f['nodes']['unknown'] = child; f['nodes']['chrome']['children'].append('unknown')
            self.assertFalse(self.admitted(f))

    def test_bounds_must_be_inside_the_current_page_and_window(self):
        cases = [('page', [27, 178, 519, 511]), ('sidecar', [547, 178, 451, 512]),
                 ('sidecar', [547, 178, 0, 511]), ('contents', [27, 178, 969, 511])]
        for node, bounds in cases:
            with self.subTest(node=node, bounds=bounds):
                f = self.fixture(); f['nodes'][node]['bounds'] = bounds
                self.assertFalse(self.admitted(f))
        f = self.fixture(); f['window'] = [22, 52, 900, 642]
        self.assertFalse(self.admitted(f))


if __name__ == '__main__':
    unittest.main()
