// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract SourceRegistry {
    struct OperatorApplication {
        string profileURI;
        uint256 appliedAt;
    }

    address public owner;

    // sourceType => operator => approved
    mapping(string => mapping(address => bool)) public approvedOperators;
    mapping(string => mapping(address => OperatorApplication)) public operatorApplications;
    mapping(string => address[]) private applicantsBySourceType;
    mapping(string => mapping(address => bool)) private applicantTracked;
    mapping(string => address[]) private approvedBySourceType;
    mapping(string => mapping(address => bool)) private approvedTracked;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event OperatorApplied(string indexed sourceType, address indexed operator, string profileURI);
    event OperatorApprovalUpdated(string indexed sourceType, address indexed operator, bool approved);

    modifier onlyOwner() {
        require(msg.sender == owner, "only owner");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "invalid owner");
        address previousOwner = owner;
        owner = newOwner;
        emit OwnershipTransferred(previousOwner, newOwner);
    }

    function applyToOperate(string calldata sourceType, string calldata profileURI) external {
        require(bytes(sourceType).length > 0, "source type required");
        require(bytes(profileURI).length > 0, "profile uri required");

        operatorApplications[sourceType][msg.sender] = OperatorApplication({
            profileURI: profileURI,
            appliedAt: block.timestamp
        });
        if (!applicantTracked[sourceType][msg.sender]) {
            applicantTracked[sourceType][msg.sender] = true;
            applicantsBySourceType[sourceType].push(msg.sender);
        }

        emit OperatorApplied(sourceType, msg.sender, profileURI);
    }

    function approveOperator(string calldata sourceType, address operator) external onlyOwner {
        _setApproval(sourceType, operator, true);
    }

    function revokeOperator(string calldata sourceType, address operator) external onlyOwner {
        _setApproval(sourceType, operator, false);
    }

    function isApprovedFor(string calldata sourceType, address operator) external view returns (bool) {
        return approvedOperators[sourceType][operator];
    }

    function getApplicants(string calldata sourceType) external view returns (address[] memory) {
        return applicantsBySourceType[sourceType];
    }

    function getPendingApplicants(
        string calldata sourceType
    ) external view returns (address[] memory pendingApplicants) {
        address[] storage applicants = applicantsBySourceType[sourceType];
        uint256 pendingCount = 0;
        for (uint256 i = 0; i < applicants.length; i++) {
            address applicant = applicants[i];
            if (
                operatorApplications[sourceType][applicant].appliedAt > 0 &&
                !approvedOperators[sourceType][applicant]
            ) {
                pendingCount++;
            }
        }

        pendingApplicants = new address[](pendingCount);
        uint256 cursor = 0;
        for (uint256 i = 0; i < applicants.length; i++) {
            address applicant = applicants[i];
            if (
                operatorApplications[sourceType][applicant].appliedAt > 0 &&
                !approvedOperators[sourceType][applicant]
            ) {
                pendingApplicants[cursor] = applicant;
                cursor++;
            }
        }
    }

    function getApprovedOperators(
        string calldata sourceType
    ) external view returns (address[] memory approvedList) {
        address[] storage known = approvedBySourceType[sourceType];
        uint256 activeCount = 0;
        for (uint256 i = 0; i < known.length; i++) {
            if (approvedOperators[sourceType][known[i]]) {
                activeCount++;
            }
        }

        approvedList = new address[](activeCount);
        uint256 cursor = 0;
        for (uint256 i = 0; i < known.length; i++) {
            address operator = known[i];
            if (approvedOperators[sourceType][operator]) {
                approvedList[cursor] = operator;
                cursor++;
            }
        }
    }

    function totalApprovedForSource(string calldata sourceType) external view returns (uint256) {
        address[] storage known = approvedBySourceType[sourceType];
        uint256 count = 0;
        for (uint256 i = 0; i < known.length; i++) {
            if (approvedOperators[sourceType][known[i]]) {
                count++;
            }
        }
        return count;
    }

    function totalApproved() external view returns (uint256 count) {
        address[] storage taskOperators = approvedBySourceType["task"];
        for (uint256 i = 0; i < taskOperators.length; i++) {
            if (approvedOperators["task"][taskOperators[i]]) {
                count++;
            }
        }

        address[] storage jobOperators = approvedBySourceType["job"];
        for (uint256 i = 0; i < jobOperators.length; i++) {
            address operator = jobOperators[i];
            if (!approvedOperators["job"][operator]) {
                continue;
            }
            bool alreadyCounted = false;
            for (uint256 j = 0; j < taskOperators.length; j++) {
                if (taskOperators[j] == operator && approvedOperators["task"][operator]) {
                    alreadyCounted = true;
                    break;
                }
            }
            if (!alreadyCounted) {
                count++;
            }
        }
    }

    function _setApproval(string calldata sourceType, address operator, bool approved) internal {
        require(bytes(sourceType).length > 0, "source type required");
        require(operator != address(0), "invalid operator");

        approvedOperators[sourceType][operator] = approved;
        if (approved && !approvedTracked[sourceType][operator]) {
            approvedTracked[sourceType][operator] = true;
            approvedBySourceType[sourceType].push(operator);
        }
        emit OperatorApprovalUpdated(sourceType, operator, approved);
    }
}
