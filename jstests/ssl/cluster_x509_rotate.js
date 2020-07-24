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

    let mongos;
    function getConnPoolHosts() {
        const ret = mongos.adminCommand({connPoolStats: 1});
        assert.commandWorked(ret);
        jsTestLog("Connection pool stats by host: " + tojson(ret.hosts));
        return ret.hosts;
    }
    
    const dbPath = MongoRunner.toRealDir("$dataDir/cluster_x509_rotate_test/");
    mkdir(dbPath);
    
    copyfile("jstests/libs/ca.pem", dbPath + "/ca-test.pem");
    copyfile("jstests/libs/client.pem", dbPath + "/client-test.pem");
    copyfile("jstests/libs/server.pem", dbPath + "/server-test.pem");
    
    // server certificate is held constant so that shell can still connect
    
    let rst = new ReplSetTest({nodes: 2});
    rst.startSet({
        sslMode: "requireSSL",
        sslPEMKeyFile: dbPath + "/server-test.pem",
        sslCAFile: dbPath + "/ca-test.pem",
        sslClusterFile: dbPath + "/client-test.pem",
        sslAllowInvalidHostnames: "",
    });

    rst.initiate();
    rst.awaitReplication();

    copyfile("jstests/libs/trusted-ca.pem", dbPath + "/ca-test.pem");
    copyfile("jstests/libs/trusted-client.pem", dbPath + "/client-test.pem");
    copyfile("jstests/libs/trusted-server.pem", dbPath + "/server-test.pem");

    jsTestLog("Nodes: " + tojson(rst.nodes));
    for(let node of rst.nodes) {
        jsTestLog("Rotating!");
        assert.commandWorked(node.adminCommand({rotateCertificates: 1}));
    }

    let newnode = rst.add({
        sslMode: "requireSSL",
        sslPEMKeyFile: "jstests/libs/trusted-server.pem",
        sslCAFile: "jstests/libs/trusted-ca.pem",
        sslClusterFile: "jstests/libs/trusted-client.pem",
        sslAllowInvalidHostnames: "",
        waitForConnect: false,
    });

    assert.eq(0, runMongoProgram("mongo", "--ssl", "--sslAllowInvalidHostnames", "--host", newnode.host, "--sslPEMKeyFile", "jstests/libs/trusted-client.pem", "--sslCAFile", "jstests/libs/trusted-ca.pem", "--eval", ";"));

    rst.reInitiate();

    rst.stopSet();
    return;

    const primary = rst.getPrimary();
    const primaryId = rst.getNodeId(primary);
    
    // Swap out the certificate files and rotate. If rotate works, mongos should be able to connect to the restarted shard.
    copyfile("jstests/libs/trusted-ca.pem", dbPath + "/ca-test.pem");
    copyfile("jstests/libs/trusted-client.pem", dbPath + "/client-test.pem");
    copyfile("jstests/libs/trusted-server.pem", dbPath + "/server-test.pem");
    assert.commandWorked(mongos.adminCommand({multicast: {ping: 0}}));

    assert.soon(() => {
        assert.commandWorked(primary.adminCommand({rotateCertificates: 1}));
        return true;
    });
    

    }());
    