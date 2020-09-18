const fs = require('fs');
const path = require('path');
const util = require('util');

// json reading method
function readJson(path) {
    try {
        return JSON.parse(fs.readFileSync(path));
    } catch (error) {
        console.log("[ERROR] An error occured while reading:" + path);
        console.log(error);
        process.exit(1);
    }
}

// Makes sure that we are using the same context, and if not outputs a warning
// Returns the context without fields that are not related to a benchmark config
function checkConfigRelatedContextData(previousConfigContext, jsonFile, filePath) {
    // Copy context and remove fields that can change from one run to another
    newContext = { ...jsonFile.context };
    delete newContext.date;
    delete newContext.executable;
    delete newContext.load_avg;

    if (previousConfigContext) {
        if (!util.isDeepStrictEqual(previousConfigContext, newContext)) {
            console.warn(`[WARN] - Context in file '${filePath}' is different from the previous one, we suggest giving different Config to different contexts. (run the 'calcite upload -BC Config' command once per config)`);
        }
    }
    return newContext;
}

function mergeReports(filesList)
{
    let partialConfigContext = null;
    testsuites = new Map();
    filesList.forEach(filePath => {
        const jsonFile = readJson(filePath);

        partialConfigContext = checkConfigRelatedContextData(partialConfigContext, jsonFile, filePath);

        const testsuiteName = path.basename(jsonFile.context.executable);
        if (!testsuites.get(testsuiteName)) {
            testsuites.set(testsuiteName, new Map());
        }
        const mergedResults = testsuites.get(testsuiteName);

        const benchsNoAggregate = jsonFile.benchmarks.filter(bench => bench.run_type === 'iteration');

        const res = benchsNoAggregate.reduce((results, benchmark) => {
            const perfTestResults = results.get(benchmark.run_name);
            // Note: we do not use benchmark.repetition_index as we want to be able to merge multiple reports
            if (perfTestResults) {
                perfTestResults.real_time.push(benchmark.real_time);
                perfTestResults.cpu_time.push(benchmark.cpu_time);
            }
            else {
                results.set(benchmark.run_name, {
                    name: benchmark.run_name,
                    unit: benchmark.time_unit,
                    real_time: [benchmark.real_time],
                    cpu_time: [benchmark.cpu_time],
                });
            }
            return results;
        }, mergedResults);
    });

    return testsuites;
}

function getTestSuites(filesList) {
    let partialConfigContext = null;
    const testsuites = mergeReports(filesList);

    const testsuitesAsArray = [];

    testsuites.forEach((content, name) => {
        testsuitesAsArray.push({
            name,
            tests: [...content.values()].map(testRes => {
                return {
                    name: testRes.name,
                    dataPoints: [
                        {
                            name: 'real_time',
                            values: testRes.real_time,
                            unit: testRes.unit,
                            aggregationPolicy: 'median',
                            diffPolicy: 'relativeDifference',
                            regressionPolicy: 'lessIsBetter',
                            regressionArgument: 20

                        },
                        {
                            name: 'cpu_time',
                            values: testRes.cpu_time,
                            unit: testRes.unit,
                            aggregationPolicy: 'median',
                            diffPolicy: 'relativeDifference',
                            regressionPolicy: 'lessIsBetter',
                            regressionArgument: 20
                        }
                    ]
                }
            })
        });
    });

    return testsuitesAsArray;

}

// TODO: use https://www.npmjs.com/package/glob ?
async function buildFilesList(pathsList, fileRegex)
{
    const pathsArray = pathsList.split(path.delimiter);
    return (await Promise.all( pathsArray.map( async pathEntry => {
        try{
            const filesInPath = await fs.promises.readdir(pathEntry, { withFileTypes: true });
            const test = filesInPath.map( file => 
            {
                if(file.isDirectory())
                {
                    // no recursion allowed
                }
                else if(file.isFile() && fileRegex.test(file.name))
                {
                    return path.join(pathEntry, file.name);
                }
                return null;
            }
            ).filter( x => x !== null );
            return test;

        } catch(_)
        {
            return [pathEntry];
        }
    }))).flat();
}

module.exports = async function () {
    if (!process.env.BENCH_OUTPUT_FILES) {
        console.error('[Error] - The BENCH_OUTPUT_FILES env variable was not set');
        process.exit(1);
    }

    const filesList = await buildFilesList(process.env.BENCH_OUTPUT_FILES, /.*\.json$/);
    const testSuites = getTestSuites(filesList);

    // return all test suites
    return {
        testSuites
    };
};
