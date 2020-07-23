// Check that rotation works for the cluster certificate

(function() {
    "use strict";

    load('jstests/ssl/libs/ssl_helpers.js');
    
    if (determineSSLProvider() === "openssl" || determineSSLProvider() === "apple") {    
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
    
    copyfile("jstests/libs/crl.pem", dbPath + "/crl-test.pem");

    let mongod = MongoRunner.runMongod({
        sslMode: "requireSSL",
        sslPEMKeyFile: "jstests/libs/server.pem",
        sslCAFile: "jstests/libs/ca.pem",
        sslCRLFile: dbPath + "/crl-test.pem"
    });

    const host = "localhost:" + mongod.port;

    // Make sure that client-revoked can connect
    let out = runMongoProgram("mongo", "--host", host, "--ssl", "--sslPEMKeyFile", "jstests/libs/client_revoked.pem", "--sslCAFile", "jstests/libs/ca.pem", "--eval", ";");
    assert.eq(out, 0);

    // Rotate in new CRL
    copyfile("jstests/libs/crl_client_revoked.pem", dbPath + "/crl-test.pem");

    mongod.adminCommand({rotateCertificates: 1});

    // Make sure client-revoked can't connect
    out = runMongoProgram("mongo", "--host", host, "--ssl", "--sslPEMKeyFile", "jstests/libs/client_revoked.pem", "--sslCAFile", "jstests/libs/ca.pem", "--eval", ";");
    assert.neq(out, 0, "Mongo invocation did not fail");

    // Make sure client can still connect
    out = runMongoProgram("mongo", "--host", host, "--ssl", "--sslPEMKeyFile", "jstests/libs/client.pem", "--sslCAFile", "jstests/libs/ca.pem", "--eval", ";");
    assert.eq(out, 0, "Mongo invocation failed");
}());