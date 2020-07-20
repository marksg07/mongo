// Check that rotation works for the cluster certificate

(function() {
    "use strict";

    load('jstests/ssl/libs/ssl_helpers.js');
    
    if (determineSSLProvider() === "openssl") {    
        return;
    }
    
    function winpath(p) {
        return p.replace(/\//g, "\\");
    }
    
    function copyfile(a, b) {
        if(_isWindows()) {
            return assert.eq(0, runProgram("cmd.exe", "/c", "copy", winpath(a), winpath(b)));
        }
        return assert.eq(0, runProgram("cp", a, b));
    }

    const dbPath = MongoRunner.toRealDir("$dataDir/cluster_x509_rotate_test/");
    mkdir(dbPath);
    
    copyfile("jstests/libs/ca.pem", dbPath + "/ca-test.pem");
    copyfile("jstests/libs/client.pem", dbPath + "/client-test.pem");
    copyfile("jstests/libs/server.pem", dbPath + "/server-test.pem");

    let mongod = MongoRunner.runMongod({
        sslMode: "requireSSL",
        sslPEMKeyFile: dbPath + "/server-test.pem",
        sslCAFile: dbPath + "/ca-test.pem"
    });

    // Rotate in new certificates
    copyfile("jstests/libs/trusted-ca.pem", dbPath + "/ca-test.pem");
    copyfile("jstests/libs/trusted-client.pem", dbPath + "/client-test.pem");
    copyfile("jstests/libs/trusted-server.pem", dbPath + "/server-test.pem");

    mongod.adminCommand({rotateCertificates: 1});

    // Start shell with old certificates and make sure it can't connecty
    let out = runMongoProgram("mongo", "--ssl", "--sslPEMKeyFile", "jstests/libs/client.pem", "--sslCAFile", "jstests/libs/ca.pem", "--eval", ";");
    assert.neq(out, 0, "Mongo invocation did not fail");

    // Start shell with new certificates and make sure it can connect
    out = runMongoProgram("mongo", "--ssl", "--sslPEMKeyFile", dbPath + "/client-test.pem", "--sslCAFile", dbPath + "/ca-test.pem", "--eval", ";");
    assert.eq(out, 0, "Mongo invocation failed");
}());