var DEFAULT_DESTINATION = 'target/screenshots';
var SCREENSHOT_TIMEOUT_INTERVAL = 2000;

var fs     = require('fs'),
    mkdirp = require('mkdirp'),
    _      = require('lodash'),
    path   = require('path'),
    hat    = require('hat');

require('string.prototype.startswith');

function Jasmine2ScreenShotReporter(opts) {
    'use strict';

    var self = this,
        suites       = {},   // suite clones
        specs        = {},   // tes spec clones
        runningSuite = null, // currently running suite

    // report marks
        marks = {
            pending:'<span class="pending">~</span>',
            failed: '<span class="failed">&#10007;</span>',
            passed: '<span class="passed">&#10003;</span>'
        },
    // when use use fit, jasmine never calls suiteStarted / suiteDone, so make a fake one to use
        fakeFocusedSuite = {
            id: 'focused',
            description: 'focused specs',
            fullName: 'focused specs'
        };

    var linkTemplate = _.template(
        '<li>' +
        '<a class="clearfix" href="<%= filename %>"><%= mark %>' +
        '<%= name %>' +
        '(<%= duration %> s)' +
        '<img src="<%= filename %>" width="80" />' +
        '<%= reason %></a>' +
        '</li>'
    );

    var nonLinkTemplate = _.template(
        '<li title="No screenshot was created for this test case.">' +
        '<%= mark %>' +
        '<%= name %> ' +
        '(<%= duration %> s)' +
        '<%= reason %>' +
        '</li>'
    );

    var reportTemplate = _.template(
        '<html>' +
        '<head>' +
        '<meta charset="utf-8">' +
        '<link rel="stylesheet" href="https://maxcdn.bootstrapcdn.com/bootstrap/3.3.5/css/bootstrap.min.css">' +
        '<style>' +
        'body { font-family: Arial; }' +
        'ul { list-style-position: inside; }' +
        '.passed { padding: 0 1em; color: green; }' +
        '.failed { padding: 0 1em; color: red; }' +
        '.pending { padding: 0 1em; color: orange; }' +
        'img { float: right; }' +
        'a { width: 100%; display: block; text-decoration: none;  }' +
        'a:hover { text-decoration: none; background: #ddddff; }' +
        '</style>' +
        '</head>' +
        '<body><div class="container"><%= report %></div></body>' +
        '</html>'
    );

    var reasonsTemplate = _.template(
        '<ul>' +
        '<% _.forEach(reasons, function(reason) { %>' +
        '<li><%- reason.message %></li>' +
        '<% }); %>' +
        '</ul>'
    );

    // write data into opts.dest as filename
    var writeScreenshot = function (data, filename) {
        var stream = fs.createWriteStream(opts.dest + filename);
        stream.write(new Buffer(data, 'base64'));
        stream.end();
    };

    var writeMetadata = function(data, filename) {
        var stream;

        try {
            stream = fs.createWriteStream(filename);
            stream.write(JSON.stringify(data, null, '\t'));
            stream.end();
        } catch(e) {
            console.error('Couldn\'t save metadata: ' + filename);
        }

    };

    // returns suite clone or creates one
    var getSuiteClone = function(suite) {
        suites[suite.id] = _.extend((suites[suite.id] || {}), suite);
        return suites[suite.id];
    };

    // returns spec clone or creates one
    var getSpecClone = function(spec) {
        specs[spec.id] = _.extend((specs[spec.id] || {}), spec);
        return specs[spec.id];
    };

    // returns duration in seconds
    var getDuration = function(obj) {
        if (!obj._started || !obj._finished) {
            return 0;
        }
        var duration = (obj._finished - obj._started) / 1000;
        return (duration < 1) ? duration : Math.round(duration);
    };

    var pathBuilder = function(spec, suites, capabilities) {
        return hat();
    };

    var metadataBuilder = function(spec, suites, capabilities) {
        return false;
    };

    var isSpecValid = function(spec) {
        // Don't screenshot skipped specs
        var isSkipped = opts.ignoreSkippedSpecs && spec.status === 'pending';
        // Screenshot only for failed specs
        var isIgnored = opts.captureOnlyFailedSpecs && spec.status !== 'failed';
        // Don't screenshot for disabled specs
        var isDisabled = spec.status === 'disabled';

        return !isSkipped && !isIgnored && !isDisabled;
    };

    var isSpecReportable = function(spec) {
        return (opts.reportOnlyFailedSpecs && spec.status === 'failed') || !opts.reportOnlyFailedSpecs;
    };

    var hasValidSpecs = function(suite) {
        var validSuites = false;
        var validSpecs = false;

        if (suite._suites.length) {
            validSuites = _.any(suite._suites, function(s) {
                return hasValidSpecs(s);
            });
        }

        if (suite._specs.length) {
            validSpecs = _.any(suite._specs, function(s) {
                return isSpecValid(s) || isSpecReportable(s);
            });
        }

        return validSuites || validSpecs;
    };

    var getDestination = function(){
        return (opts.dest || DEFAULT_DESTINATION) + '/';
    };

    var getDestinationWithUniqueDirectory = function(){
        return getDestination() + hat() + '/';
    };

    // TODO: more options
    opts          = opts || {};
    opts.preserveDirectory = opts.preserveDirectory || false;
    opts.dest     = opts.preserveDirectory ?  getDestinationWithUniqueDirectory() : getDestination();
    opts.filename = opts.filename || 'report.html';
    opts.ignoreSkippedSpecs = opts.ignoreSkippedSpecs || false;
    opts.reportOnlyFailedSpecs = opts.hasOwnProperty('reportOnlyFailedSpecs') ? opts.reportOnlyFailedSpecs : true;
    opts.captureOnlyFailedSpecs = opts.captureOnlyFailedSpecs || false;
    opts.pathBuilder = opts.pathBuilder || pathBuilder;
    opts.metadataBuilder = opts.metadataBuilder || metadataBuilder;
    opts.screenshotTimeout = opts.screenshotTimeout || SCREENSHOT_TIMEOUT_INTERVAL;
    opts.specDone = opts.specDone || function(spec) {};

    this.jasmineStarted = function() {
        mkdirp(opts.dest, function(err) {
            var files;

            if(err) {
                throw new Error('Could not create directory ' + opts.dest);
            }

            files = fs.readdirSync(opts.dest);

            _.each(files, function(file) {
                var filepath = opts.dest + file;
                if (fs.statSync(filepath).isFile()) {
                    fs.unlinkSync(filepath);
                }
            });
        });
    };

    this.suiteStarted = function(suite) {
        suite = getSuiteClone(suite);
        suite._suites = [];
        suite._specs = [];
        suite._started = Date.now();
        suite._parent = runningSuite;

        if (runningSuite) {
            runningSuite._suites.push(suite);
        }

        runningSuite = suite;

    };

    this.suiteDone = function(suite) {
        suite = getSuiteClone(suite);
        if (suite._parent === undefined) {
            // disabled suite (xdescribe) -- suiteStarted was never called
            self.suiteStarted(suite);
        }
        suite._finished = Date.now();
        runningSuite = suite._parent;
    };

    // Patch the jasmine.Spec execute function
    // to publish the actual Spec object.
    var _execute = jasmine.Spec.prototype.execute;
    jasmine.Spec.prototype.execute = function() {
        var clonedSpec = getSpecClone(this.result);
        clonedSpec._spec = this;
        return _execute.apply(this, arguments);
    }

    this.specStarted = function(spec) {
        if (!runningSuite) {
            // focused spec (fit) -- suiteStarted was never called
            self.suiteStarted(fakeFocusedSuite);
        }

        var clonedSpec = getSpecClone(spec);
        clonedSpec._started = Date.now();
        clonedSpec._suite = runningSuite;

        var spec = clonedSpec._spec;

        if (spec) {
            // Take a screenshot after the spec is complete.
            var afterSpec = function(done) {
                browser.getCapabilities().then(function (capabilities) {
                    clonedSpec._capabilities = capabilities;
                    browser.driver.manage().window().getSize().then(function(windowSize) {
                        clonedSpec._windowSize = windowSize;
                        browser.takeScreenshot().then(function (png) {
                            clonedSpec._png = png;
                            done();
                        });
                    });
                });
            }
            var _beforeAndAfterFns = spec.beforeAndAfterFns;
            spec.beforeAndAfterFns = function() {
                var old = _beforeAndAfterFns.call(this);
                old.afters.push({
                    fn: afterSpec,
                    timeout: function() { return opts.screenshotTimeout; }
                });
                return old;
            }
        } else {
            console.log("jasmine Spec execute patching did not work for this spec.")
        }
        runningSuite._specs.push(clonedSpec);
    };

    this.specDone = function(spec) {
        var file;
        spec = getSpecClone(spec);
        spec._finished = Date.now();

        if (!isSpecValid(spec)) {
            spec.skipPrinting = true;
            opts.specDone(spec);
            return;
        }

        file = opts.pathBuilder(spec, suites, spec._capabilities, spec._windowSize);
        spec.filename = file + '.png';

        var screenshotPath,
            metadataPath,
            metadata;

        screenshotPath = path.join(opts.dest, spec.filename);
        metadata       = opts.metadataBuilder(spec, suites, spec._capabilities);

        if (metadata) {
            metadataPath = path.join(opts.dest, file + '.json');
            mkdirp(path.dirname(metadataPath), function(err) {
                if(err) {
                    throw new Error('Could not create directory for ' + metadataPath);
                }
                writeMetadata(metadata, metadataPath);
            });
        }
        mkdirp(path.dirname(screenshotPath), function(err) {
            if(err) {
                throw new Error('Could not create directory for ' + screenshotPath);
            }
            writeScreenshot(spec._png, spec.filename);
            opts.specDone(spec);
        });
    };

    this.jasmineDone = function() {
        var output = '';

        if (runningSuite) {
            // focused spec (fit) -- suiteDone was never called
            self.suiteDone(fakeFocusedSuite);
        }

        var outputs = {};

        _.each(suites, function(suite) {
            outputs[suite.fullName] = outputs[suite.fullName] ? outputs[suite.fullName] : '';
            outputs[suite.fullName] += outputs[suite.fullName] ? printResults(suite, true) : printResults(suite, false);
        });

        for(var key in outputs)
        {
            output += outputs[key];
        }



        /*_.each(suites, function(suite) {
         output += printResults(suite);
         });*/

        // Ideally this shouldn't happen, but some versions of jasmine will allow it
        _.each(specs, function(spec) {
            output += printSpec(spec);
        });

        fs.appendFileSync(
            opts.dest + opts.filename,
            reportTemplate({ report: output}),
            { encoding: 'utf8' },
            function(err) {
                if(err) {
                    console.error('Error writing to file:' + opts.dest + opts.filename);
                    throw err;
                }
            }
        );
    };

    function printSpec(spec) {
        var suiteName = spec._suite ? spec._suite.fullName : '';
        var template = spec.filename ? linkTemplate : nonLinkTemplate;

        if (spec.isPrinted || (spec.skipPrinting && !isSpecReportable(spec))) {
            return '';
        }

        spec.isPrinted = true;

        return template({
            mark:     marks[spec.status],
            name:     spec.fullName.replace(suiteName, '').trim(),
            reason:   printReasonsForFailure(spec),
            filename: encodeURIComponent(spec.filename),
            duration: getDuration(spec),
        });
    }

    // TODO: proper nesting -> no need for magic
    function printResults(suite, omitTitle) {
        var output = '';

        if (suite.isPrinted || !hasValidSpecs(suite)) {
            return '';
        }

        suite.isPrinted = true;

        output += '<ul style="list-style-type:none">';
        //output += '<h4>' + suite.fullName + ' (' + getDuration(suite) + ' s)</h4>';

        if(!omitTitle)
        {
            var windowSize = {width: '', height: ''}, browserName = '';

            _.each(suite._specs, function(spec)
            {
                spec = specs[spec.id];
                var browserCapabilities = spec._capabilities;

                var newBrowserName = browserCapabilities.get('browserName');
                if(newBrowserName) browserName = newBrowserName;

                var newWindowSize = spec._windowSize;
                if(newWindowSize) windowSize = newWindowSize;
            });
            //console.log(suite._specs[0]._capabilities);
            //var browserCapabilities = suite._specs[0]._capabilities;
            //console.log(browserCapabilities.get('browserName'));

            //output += '<h4>' + suite.fullName + ' (' + getDuration(suite) + ' s on ' + browserName + ')</h4>';
            if(browserName)
            {
                output += '<h4>' + suite.fullName + ' (' + getDuration(suite) + ' s on ' + browserName + ', ' + windowSize.width + 'x' + windowSize.height + ')</h4>';
            }
            else
            {
                output += '<h4>' + suite.fullName + ' (' + getDuration(suite) + ' s)</h4>';
            }
        }

        _.each(suite._specs, function(spec) {
            spec = specs[spec.id];
            output += printSpec(spec);
        });

        if (suite._suites.length) {
            _.each(suite._suites, function(childSuite) {
                output += printResults(childSuite);
            });
        }

        output += '</ul>';

        return output;
    }

    function printReasonsForFailure(spec) {
        if (spec.status !== 'failed') {
            return '';
        }

        return reasonsTemplate({ reasons: spec.failedExpectations });
    }

    return this;
}

module.exports = Jasmine2ScreenShotReporter;
