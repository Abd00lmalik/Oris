// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface ICredentialHook {
    function onJobComplete(address agent, uint256 jobId) external returns (uint256);
}

contract ERC8183Job {
    enum SubmissionStatus {
        None,
        Submitted,
        Approved,
        Rejected
    }

    struct Job {
        uint256 jobId;
        address client;
        string title;
        string description;
        uint256 deadline;
        uint256 rewardUSDC;
        uint256 createdAt;
        uint256 acceptedCount;
        uint256 submissionCount;
    }

    struct Submission {
        address agent;
        string deliverableLink;
        SubmissionStatus status;
        uint256 submittedAt;
        string reviewerNote;
        bool credentialClaimed;
    }

    struct SubmissionView {
        address agent;
        string deliverableLink;
        SubmissionStatus status;
        uint256 submittedAt;
        string reviewerNote;
        bool credentialClaimed;
    }

    uint256 public nextJobId;
    address public immutable hook;
    mapping(uint256 => Job) private jobs;
    mapping(uint256 => address[]) private acceptedAgentsByJob;
    mapping(uint256 => mapping(address => bool)) public isAccepted;
    mapping(uint256 => address[]) private submissionAgentsByJob;
    mapping(uint256 => mapping(address => Submission)) private submissions;

    event JobCreated(
        uint256 indexed jobId,
        address indexed client,
        string title,
        string description,
        uint256 deadline,
        uint256 rewardUSDC
    );
    event JobAccepted(uint256 indexed jobId, address indexed agent);
    event DeliverableSubmitted(uint256 indexed jobId, address indexed agent, string deliverableLink);
    event SubmissionApproved(uint256 indexed jobId, address indexed agent);
    event SubmissionRejected(uint256 indexed jobId, address indexed agent, string reviewerNote);
    event CredentialClaimed(
        uint256 indexed jobId,
        address indexed agent,
        uint256 credentialRecordId
    );

    constructor(address hookAddress) {
        require(hookAddress != address(0), "invalid hook");
        hook = hookAddress;
    }

    function createJob(
        string calldata title,
        string calldata description,
        uint256 deadline,
        uint256 rewardUSDC
    ) external returns (uint256 createdJobId) {
        require(bytes(title).length > 0, "title required");
        require(bytes(description).length > 0, "description required");
        require(deadline > block.timestamp, "deadline must be future");

        createdJobId = nextJobId;
        nextJobId += 1;

        jobs[createdJobId] = Job({
            jobId: createdJobId,
            client: msg.sender,
            title: title,
            description: description,
            deadline: deadline,
            rewardUSDC: rewardUSDC,
            createdAt: block.timestamp,
            acceptedCount: 0,
            submissionCount: 0
        });

        emit JobCreated(createdJobId, msg.sender, title, description, deadline, rewardUSDC);
    }

    function acceptJob(uint256 jobId) external {
        Job storage job = _getExistingJob(jobId);
        require(block.timestamp <= job.deadline, "job deadline passed");
        require(msg.sender != job.client, "client cannot accept own job");
        require(!isAccepted[jobId][msg.sender], "already accepted");

        isAccepted[jobId][msg.sender] = true;
        acceptedAgentsByJob[jobId].push(msg.sender);
        job.acceptedCount += 1;

        emit JobAccepted(jobId, msg.sender);
    }

    function submitDeliverable(uint256 jobId, string calldata deliverableLink) external {
        Job storage job = _getExistingJob(jobId);
        require(block.timestamp <= job.deadline, "job deadline passed");
        require(isAccepted[jobId][msg.sender], "accept job first");
        require(bytes(deliverableLink).length > 0, "deliverable link required");

        Submission storage submission = submissions[jobId][msg.sender];
        if (submission.agent == address(0)) {
            submission.agent = msg.sender;
            submissionAgentsByJob[jobId].push(msg.sender);
            job.submissionCount += 1;
        }

        require(!submission.credentialClaimed, "credential already claimed");

        submission.deliverableLink = deliverableLink;
        submission.status = SubmissionStatus.Submitted;
        submission.submittedAt = block.timestamp;
        submission.reviewerNote = "";
        submission.credentialClaimed = false;

        emit DeliverableSubmitted(jobId, msg.sender, deliverableLink);
    }

    function approveSubmission(uint256 jobId, address agent) external {
        Job storage job = _getExistingJob(jobId);
        require(msg.sender == job.client, "only client can review");
        require(agent != address(0), "invalid agent");

        Submission storage submission = submissions[jobId][agent];
        require(submission.status == SubmissionStatus.Submitted, "submission not pending");

        submission.status = SubmissionStatus.Approved;
        submission.reviewerNote = "";

        emit SubmissionApproved(jobId, agent);
    }

    function rejectSubmission(uint256 jobId, address agent, string calldata reviewerNote) external {
        Job storage job = _getExistingJob(jobId);
        require(msg.sender == job.client, "only client can review");
        require(agent != address(0), "invalid agent");

        Submission storage submission = submissions[jobId][agent];
        require(submission.status == SubmissionStatus.Submitted, "submission not pending");

        submission.status = SubmissionStatus.Rejected;
        submission.reviewerNote = reviewerNote;

        emit SubmissionRejected(jobId, agent, reviewerNote);
    }

    function claimCredential(uint256 jobId) external returns (uint256 credentialRecordId) {
        Submission storage submission = submissions[jobId][msg.sender];
        require(submission.status == SubmissionStatus.Approved, "submission not approved");
        require(!submission.credentialClaimed, "credential already claimed");

        submission.credentialClaimed = true;
        credentialRecordId = ICredentialHook(hook).onJobComplete(msg.sender, jobId);

        emit CredentialClaimed(jobId, msg.sender, credentialRecordId);
    }

    function getJob(uint256 jobId) external view returns (Job memory) {
        return _getExistingJob(jobId);
    }

    function getSubmission(uint256 jobId, address agent) external view returns (Submission memory) {
        _getExistingJob(jobId);
        return submissions[jobId][agent];
    }

    function getAcceptedAgents(uint256 jobId) external view returns (address[] memory) {
        _getExistingJob(jobId);
        return acceptedAgentsByJob[jobId];
    }

    function getSubmissions(uint256 jobId) external view returns (SubmissionView[] memory allSubmissions) {
        _getExistingJob(jobId);
        address[] storage agents = submissionAgentsByJob[jobId];
        allSubmissions = new SubmissionView[](agents.length);

        for (uint256 i = 0; i < agents.length; i++) {
            Submission storage submission = submissions[jobId][agents[i]];
            allSubmissions[i] = SubmissionView({
                agent: submission.agent,
                deliverableLink: submission.deliverableLink,
                status: submission.status,
                submittedAt: submission.submittedAt,
                reviewerNote: submission.reviewerNote,
                credentialClaimed: submission.credentialClaimed
            });
        }
    }

    function getAllJobs() external view returns (Job[] memory allJobs) {
        allJobs = new Job[](nextJobId);
        for (uint256 i = 0; i < nextJobId; i++) {
            allJobs[i] = jobs[i];
        }
    }

    function _getExistingJob(uint256 jobId) internal view returns (Job storage) {
        Job storage job = jobs[jobId];
        require(job.client != address(0), "job does not exist");
        return job;
    }
}
